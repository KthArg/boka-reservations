# 0024 — CSP con nonces por request (strict-dynamic)

- **Estado**: draft
- **Autor**: kenneth
- **Creado**: 2026-06-14
- **Última actualización**: 2026-06-14 (revisado por spec-reviewer: corregidos 3 bloqueantes — propagación real del nonce sobre el middleware de next-intl, carga real del SDK de OnvoPay, y separación loader vs iframe; decisiones de §13 resueltas)
- **Rama**: feat/0024-csp-nonces (cuando aplique)
- **PR**: #<número> (cuando aplique)

## 1. Contexto y motivación

La Content-Security-Policy actual (definida en `web/next.config.ts`, spec 0016 M-2) usa `'unsafe-inline'` en `script-src` y `style-src`. Eso debilita la CSP: si una falla de XSS lograra inyectar un `<script>` inline en una página, la política **no lo bloquearía**, porque `'unsafe-inline'` autoriza cualquier script inline sin distinción.

`'unsafe-inline'` está hoy porque los scripts de hidratación de Next 15 / React 19 se emiten inline sin un nonce, y la CSP se sirve como header **estático** (`next.config.ts > headers()`), que es el mismo para todas las respuestas y por lo tanto no puede contener un nonce por request.

La re-auditoría del Security Council (`docs/security-audits/2026-06-13-reauditoria-1.md`) dejó esto como hallazgo P3 (baja severidad, no explotable hoy: no hay vector de XSS conocido en la app). El spec 0023 lo declaró explícitamente fuera de alcance por ser un cambio grande y con riesgo propio. Este spec recoge ese trabajo de forma aislada.

El objetivo es pasar a una CSP basada en **nonce por request + `strict-dynamic`** para `script-src`, de modo que sólo se ejecuten los scripts que el servidor marcó explícitamente (los de Next y los que éstos carguen), eliminando `'unsafe-inline'` de scripts. Esto **modifica el contrato de CSP que estableció el spec 0016** (deja de ser un header estático en `next.config.ts` y pasa a generarse por request en el middleware).

## 2. Objetivos

- Eliminar `'unsafe-inline'` de `script-src` reemplazándolo por un nonce único por request más `'strict-dynamic'`, en todas las respuestas HTML.
- Generar el nonce en el middleware (por request) y propagarlo tanto a la respuesta (header CSP) como a Next (para que firme sus scripts de hidratación), sin romper el rewrite de locale de next-intl ni el refresh de cookies de Supabase que hoy hace el middleware.
- Mantener funcionando la carga del SDK de OnvoPay bajo `strict-dynamic` (ajustando su carga si la verificación lo exige) y la captura de errores de Sentry.
- Mantener intactos los demás headers de seguridad estáticos (HSTS, X-Frame-Options, etc.) sin emitir dos headers CSP contradictorios.

## 3. Fuera de alcance

- **`style-src 'unsafe-inline'` se mantiene.** React emite atributos `style="..."` inline que un nonce no cubre (los nonces aplican a `<style>`/`<link>`, no a atributos de estilo), y CSS-in-JS de terceros agrava esto. Quitar `'unsafe-inline'` de estilos exigiría refactors invasivos por beneficio marginal (la inyección de CSS no ejecuta JS). Queda como residuo aceptado y documentado.
- No se cambia la lista de orígenes permitidos (OnvoPay, Supabase, Sentry); sólo el mecanismo de autorización de scripts.
- No se agrega un endpoint permanente de `report-uri`/`report-to`. Se usa `Content-Security-Policy-Report-Only` sólo como herramienta temporal de rollout (§11), no como entregable.
- No se toca el `'unsafe-eval'` que sólo se agrega en desarrollo para HMR; en producción ya no se incluye.

## 4. Historias de usuario

> Como responsable de seguridad del proyecto, quiero que la CSP bloquee scripts inline no autorizados, para que una eventual inyección de XSS no pueda ejecutar código en el navegador del usuario.

Criterios de aceptación:

- [ ] En producción, el header `Content-Security-Policy` de cada respuesta HTML contiene `script-src` con `'nonce-<valor>'` y `'strict-dynamic'`, y **no** contiene `'unsafe-inline'` en `script-src`.
- [ ] El nonce es distinto en cada request, y el valor del `'nonce-...'` en el header CSP **coincide** con el atributo `nonce="..."` de los `<script>` que Next emite en el HTML servido (es lo que garantiza que la hidratación no rompa).
- [ ] Las páginas del portal público (`/`, `/tours`, `/tours/[id]`), el checkout, el panel admin y el login cargan y se hidratan sin errores de CSP en la consola del navegador.
- [ ] El checkout completa un pago real con el widget de OnvoPay sin violaciones de CSP que rompan el flujo.
- [ ] Sentry sigue capturando errores del browser (su script se ejecuta bajo la nueva política).
- [ ] En desarrollo, HMR/React-refresh sigue funcionando (se conserva `'unsafe-eval'` sólo en dev).
- [ ] El refresh de sesión de Supabase y el rewrite de locale de next-intl siguen funcionando (no se rompe el comportamiento actual del middleware).

## 5. Diseño técnico

### Punto de partida real del middleware

`web/middleware.ts` hoy **no** usa `NextResponse.next()`. Hace:

```
const response = intlMiddleware(request);                 // next-intl arma la respuesta (rewrite de locale)
const supabase = createSupabaseMiddlewareClient(request, response); // engancha el refresh de cookies a ESA respuesta
await supabase.auth.getUser();                            // refresca sesión (escribe cookies en response)
if (isProtectedPath) { ... return NextResponse.redirect(...) }  // branch de redirect (ACCESS-02)
return response;
```

El refresh de cookies de Supabase depende de devolver **esa misma** `response`; descartarla rompe la sesión (hay un comentario en el código advirtiéndolo). Por eso el nonce debe integrarse sin reemplazar la respuesta de next-intl.

### Generación y propagación del nonce

1. **Generar** el nonce con Web Crypto (edge-safe, igual que el `atob`/`TextDecoder` que ya usa el middleware; nada de `node:crypto` ni `Buffer`): 16 bytes aleatorios con `crypto.getRandomValues(new Uint8Array(16))` codificados a base64. Forma única y fija para que el test sea determinista en formato.
2. **Que Next lea el nonce**: Next aplica el nonce a sus `<script>` cuando lo encuentra en los **request headers** que recibe al renderizar. Como la respuesta la produce `intlMiddleware`, hay que pasarle a next-intl un request con el header `x-nonce` agregado: clonar los headers del request, setear `x-nonce`, y construir el request que recibe `intlMiddleware` (p. ej. `intlMiddleware` sobre un `NextRequest` con esos headers, o el mecanismo equivalente que exponga next-intl). Validar en implementación que next-intl preserva ese request header hacia el render de Next (es el punto técnico a confirmar de este spec).
3. **Setear la CSP en la respuesta**: agregar el header `Content-Security-Policy` con el mismo nonce a `response` **y** al `NextResponse.redirect(...)` del branch protegido (ambos caminos deben llevar CSP).
4. El nonce queda disponible para Server Components vía el request header `x-nonce` (por si algún componente necesita firmar un script propio).

### Dónde vive la CSP (un solo header)

- La **CSP completa** (incluidas `frame-ancestors`, `frame-src`, `connect-src`, etc.) se mueve al middleware, porque debe llevar nonce por request. No puede haber dos headers CSP: el navegador aplica la **intersección** de ambos y rompería. Por lo tanto se elimina la CSP de `next.config.ts`.
- Los **headers de seguridad estáticos que no dependen del request se quedan en `next.config.ts > headers()`**: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. (`X-Frame-Options: DENY` y `frame-ancestors 'none'` quedan redundantes a propósito; no se pierde ninguno.)
- La construcción del string de CSP (directivas + orígenes de Supabase/OnvoPay/Sentry + `'unsafe-eval'` sólo en dev) se extrae a un módulo compartido que recibe el nonce, reutilizable y testeable de forma aislada.

### `strict-dynamic` y los terceros

`'strict-dynamic'` hace que el navegador **ignore** las allowlists por host y keywords como `'self'` en `script-src`: sólo confía en scripts con el nonce y en los que **esos** scripts carguen dinámicamente. `'self'`, los hosts (`https://sdk.onvopay.com`) y `https:` quedan **solo como fallback** para navegadores viejos que no soportan `strict-dynamic`; en navegadores modernos no autorizan nada por sí mismos.

Carga real del SDK de OnvoPay (`web/components/public/CheckoutForm/CheckoutForm.tsx`): dentro de un `useEffect` se hace `document.createElement('script')`, `script.src = ONVO_SDK_URL`, `document.head.appendChild(script)`, y al `onload` se llama `onvo.pay({...}).render('#onvo-payment-container')`. Análisis bajo `strict-dynamic`:

- El código que crea el `<script>` es parte de un bundle de Next ya **confiable** (firmado con nonce). `strict-dynamic` **propaga** la confianza a los scripts creados por la API DOM desde un script confiable (este es justamente el patrón que `strict-dynamic` habilita). Hipótesis de trabajo: el loader de OnvoPay seguirá cargando sin cambios.
- El widget de OnvoPay **renderiza dentro de un iframe** de `*.onvopay.com`. El contenido **dentro** del iframe tiene su propia CSP y **no** está sujeto a nuestro `script-src`/`strict-dynamic`; sólo depende de `frame-src` (ya permitido en la CSP). Por lo tanto, lo que ejecute OnvoPay adentro no se ve afectado.
- **Si** la verificación con un pago real mostrara que el loader se bloquea (p. ej. porque la propagación no aplica en algún navegador), el fix acotado es leer el nonce desde `x-nonce` y asignárselo al `<script>` creado (`script.nonce = nonce`) o migrar a `next/script`. Tocar `CheckoutForm.tsx` queda **en alcance** sólo si la verificación lo exige.

### Diagrama de flujo

```
request → middleware:
  nonce = base64(getRandomValues(16))
  req' = request + header x-nonce        → intlMiddleware(req')  → Next firma sus <script> con el nonce
  supabase.auth.getUser() (refresca cookies sobre la respuesta)
  response.headers['Content-Security-Policy'] = csp(nonce)
  (branch protegido: el redirect también lleva csp(nonce))
→ browser ejecuta sólo scripts con nonce (+ los que ésos carguen vía strict-dynamic)
```

## 6. Modelo de datos

Sin cambios al modelo de datos.

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Widget de OnvoPay (riesgo central)**. Comportamiento esperado: el loader (`createElement`) se autoriza por propagación de `strict-dynamic` desde el bundle confiable; el contenido del iframe `*.onvopay.com` no se ve afectado (cae bajo `frame-src`, ya permitido). Verificación obligatoria: un pago real end-to-end sin violaciones de CSP que rompan el flujo. Si rompe el loader, aplicar el fix acotado de §5 (`script.nonce` o `next/script`). No se mergea sin un pago real verde.
- **Render dinámico forzado**. Un nonce por request impide el cacheo estático de la respuesta HTML. **Decisión**: se acepta render dinámico en las respuestas HTML que ya pasan por el middleware (el `matcher` actual `'/((?!api|_next|_vercel|.*\\..*).*)'` ya las cubre); el beneficio de eliminar `'unsafe-inline'` globalmente supera la pérdida de cacheo estático para el volumen de este portal. Los assets (`_next`, estáticos) quedan fuera del matcher y siguen cacheables. Revisar si se observa degradación de performance.
- **Doble header CSP**. Garantizar **una sola** fuente de CSP (toda en el middleware); quitar la de `next.config.ts` para no emitir dos políticas que el navegador intersecaría.
- **Branch de redirect del middleware**. El `NextResponse.redirect` de rutas protegidas también debe llevar el header CSP (aunque sea una redirección, por consistencia y porque algunos navegadores procesan headers de la respuesta intermedia).
- **Refresh de cookies de Supabase**. La integración del nonce no debe descartar la `response` a la que Supabase engancha las cookies; verificar que la sesión sigue refrescándose.
- **Edge runtime**. Usar Web Crypto (`crypto.getRandomValues`), no `node:crypto`; consistente con el patrón edge-safe ya presente.
- **Sentry**. Su init de browser se bundlea con el cliente de Next, así que debería heredar el nonce; verificar que captura un error de prueba (depende de tener DSN configurado, ver §10).
- **Navegadores sin `strict-dynamic`**. Caen al fallback (`https:`/host-allowlist), comportamiento degradado pero no roto.

## 9. Impacto en otras áreas

- **Middleware** (`web/middleware.ts`): cambia para generar/propagar el nonce y setear la CSP; coexiste con el guard de rol (ACCESS-02) y el refresh de Supabase.
- **next.config.ts**: se le quita la CSP (se mueve al middleware); conserva los demás headers de seguridad.
- **Pagos**: área sensible. El cambio afecta cómo se autoriza la carga del SDK de OnvoPay. Requiere `payment-flow-auditor` y un pago real de verificación. Posible cambio acotado en `CheckoutForm.tsx` (sólo si la verificación lo exige).
- **Sin impacto** en DB, worker, emails, i18n ni en la lógica del panel admin.

## 10. Plan de tests

- **Unit**: el builder del string de CSP, dado un nonce, incluye `'nonce-<x>'` y `'strict-dynamic'` en `script-src` y **no** incluye `'unsafe-inline'` en scripts; conserva los orígenes de OnvoPay/Supabase/Sentry y `frame-ancestors`/`frame-src`; agrega `'unsafe-eval'` sólo cuando `NODE_ENV !== 'production'`.
- **Unit**: el middleware setea `x-nonce` en el request hacia el render y un header `Content-Security-Policy` con el **mismo** nonce en la respuesta; dos requests producen nonces distintos; el branch de redirect también lleva CSP.
- **E2E (Playwright)**: navegar portal, detalle de tour, checkout, login y dashboard; afirmar que la consola no reporta violaciones de CSP ni scripts bloqueados, y que el HTML trae `<script nonce="...">` coincidente con el header.
- **Manual (documentado en el PR)**: un pago real con OnvoPay (vía ngrok) completado sin violaciones de CSP; un error de prueba capturado por Sentry (requiere DSN configurado — si el DSN de prod aún no está, dejar registrado que esta verificación queda pendiente del checkpoint de observabilidad).

## 11. Plan de rollout

- Transición controlada por env: arrancar emitiendo `Content-Security-Policy-Report-Only` (nonce + strict-dynamic) en paralelo a la CSP enforcing vigente, para observar violaciones sin romper; promover a `Content-Security-Policy` enforcing cuando el reporte salga limpio en los flujos críticos. La env decide enforce vs report-only.
- No requiere migración de datos.
- Reversible con un cambio de config (volver a la CSP con `'unsafe-inline'`), sin estado persistente que limpiar.
- Coordinar la verificación del pago real (OnvoPay sandbox + ngrok, como en checkpoints anteriores) antes de promover a enforce en producción.

## 12. Métricas de éxito

- 0 violaciones de CSP en consola/Report-Only en los flujos críticos (portal, checkout, login, admin) durante la ventana de observación.
- `script-src` en producción sin `'unsafe-inline'` (verificable en el header de cualquier respuesta HTML).
- Tasa de éxito de checkout sin regresión tras el enforcing.

## 13. Preguntas abiertas

- [ ] **Pregunta**: ¿next-intl preserva el request header `x-nonce` hacia el render de Next con el patrón de §5, o hace falta un mecanismo específico de next-intl para inyectarlo? **Dueño**: kenneth **Antes de**: implementación (es el punto técnico a confirmar; se valida con un spike corto del middleware).
- [ ] **Pregunta**: ¿El loader de OnvoPay (`document.createElement`) sobrevive a `strict-dynamic` por propagación, o requiere el fix acotado (`script.nonce` / `next/script`)? **Dueño**: kenneth **Antes de**: enforce (se resuelve con el pago real de §10).
