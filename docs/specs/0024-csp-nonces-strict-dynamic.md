# 0024 — CSP con nonces por request (strict-dynamic)

- **Estado**: approved
- **Autor**: kenneth
- **Creado**: 2026-06-14
- **Última actualización**: 2026-06-15 (2ª y 3ª ronda de spec-reviewer: se cerró con un spike el mecanismo de propagación del nonce — verificado contra el código de `next` y `next-intl` instalados, ver §5; se corrigió la codificación base64 edge-safe; se documentó el `getSession()` extra de ACCESS-02 y el orden frente al cliente de Supabase; paridad completa de directivas en los tests; se reconcilió el criterio de Sentry y el rollout report-only. Ronda final del spec-reviewer: "Sin correcciones pendientes / listo para aprobar")
- **Rama**: feat/0024-csp-nonces
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
- [ ] El script de Sentry (cuando hay DSN) se ejecuta bajo la nueva política sin ser bloqueado por CSP. La verificación de captura real de un error **queda diferida al checkpoint de observabilidad** (depende de un DSN configurado, que hoy no existe — ver §10 y `pre-production-checklist`); no es criterio bloqueante de este spec.
- [ ] En desarrollo, HMR/React-refresh sigue funcionando (se conserva `'unsafe-eval'` sólo en dev).
- [ ] El refresh de sesión de Supabase y el rewrite de locale de next-intl siguen funcionando (no se rompe el comportamiento actual del middleware).

## 5. Diseño técnico

### Punto de partida real del middleware

`web/middleware.ts` hoy **no** usa `NextResponse.next()`. Hace (verificado contra el código vivo):

```
const response = intlMiddleware(request);                  // next-intl arma la respuesta (rewrite de locale)
const supabase = createSupabaseMiddlewareClient(request, response); // engancha el refresh de cookies a ESA respuesta
await supabase.auth.getUser();                             // refresca sesión (escribe cookies en request+response)
if (isProtectedPath(pathname)) {
  if (!user) return redirectToLogin();
  await supabase.auth.getSession();                        // ACCESS-02 (spec 0023): segundo llamado
  const role = decodeUserRole(session.access_token);       // exige rol de panel; si no → redirectToLogin()
}
return response;
```

Dos hechos del código real que el diseño del nonce debe respetar:

- El refresh de cookies de Supabase depende de devolver **esa misma** `response`; descartarla rompe la sesión (hay un comentario en el código advirtiéndolo). Por eso el nonce no debe reemplazar la respuesta de next-intl.
- El branch protegido hace **dos** llamados a Supabase (`getUser()` y `getSession()` para decodificar `user_role`) y puede terminar en un `NextResponse.redirect(...)`. El nonce/CSP debe convivir con ambos caminos (respuesta normal y redirect).

### Mecanismo de propagación del nonce — verificado en el código instalado (spike cerrado)

Este era el punto técnico abierto del spec. Se resolvió leyendo el código de `next@15.3` y `next-intl@4.12` en `node_modules`, no como hipótesis:

1. **Cómo decide Next qué nonce poner en sus `<script>`** (`next/dist/server/app-render/app-render.js`):

   ```js
   const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
   const nonce = typeof csp === 'string' ? getScriptNonceFromHeader(csp) : undefined;
   ```

   Next lee el nonce del header **`content-security-policy` (o `content-security-policy-report-only`) del _request_ que llega al render**, parseando el `'nonce-…'` de su `script-src`. **No** lee `x-nonce` (eso es solo una convención para que los componentes lo lean vía `headers()`). Implicación clave para el rollout: como acepta también el header report-only, el modo Report-Only **igual** firma los scripts de Next con el nonce.

2. **Cómo llega ese request header al render pasando por next-intl** (`next-intl/dist/.../middleware/middleware.js`): cuando next-intl resuelve con `next()`/rewrite hace `const headers = new Headers(request.headers)` y devuelve `NextResponse.rewrite(url, { request: { headers } })` (o `NextResponse.next({ request: { headers } })`). Es decir, **next-intl copia los headers del request entrante y los reenvía al render** vía la opción `request.headers`. Por lo tanto, si el request que recibe `intlMiddleware` ya trae el header CSP con el nonce, ese header llega intacto al render de Next.

3. **Implementación concreta** en `web/middleware.ts`:
   - Generar el nonce (ver abajo) y construir el string de CSP con ese nonce (módulo compartido, ver «Dónde vive la CSP»).
   - Clonar los headers del request entrante (`new Headers(request.headers)`) y setear en esa copia **`content-security-policy`** = el string de CSP (el header que Next parsea para firmar sus scripts) **y** **`x-nonce`** = el nonce (conveniencia para Server Components que quieran firmar un script propio).
   - Llamar a `intlMiddleware` con un `NextRequest` reconstruido a partir del request original que **solo** sobrescribe los headers por la copia con el nonce (preservando url, método y cookies). next-intl copia esos headers y los reenvía al render (paso 2).
   - **Supabase sigue usando el request _original_**: `createSupabaseMiddlewareClient(request, response)` lee `request.cookies`, que son idénticas (clonamos el header `cookie`), y engancha el refresh a la `response` de next-intl. El request reconstruido solo alimenta a `intlMiddleware`; no cambia el manejo de cookies. Orden: generar nonce → `response = intlMiddleware(reqConNonce)` → `createSupabaseMiddlewareClient(request, response)` → `getUser()`/branch ACCESS-02 → setear el header CSP en la salida.
4. **Setear la CSP en la _respuesta_** (lo que el navegador aplica): agregar el header `Content-Security-Policy` (o `…-Report-Only` según el env de rollout, §11) con el **mismo** nonce a `response` **y** al `NextResponse.redirect(...)` del branch protegido.

**Generación del nonce (edge-safe, sin `node:crypto` ni `Buffer`):** 16 bytes aleatorios con `crypto.getRandomValues(new Uint8Array(16))` codificados a base64 con `btoa(String.fromCharCode(...bytes))` (mismo estilo edge-safe que el `atob`/`TextDecoder` del `decodeUserRole` ya presente). El **valor** es aleatorio por request; lo que el test fija es el **formato** (string base64 no vacío, distinto entre dos requests).

**Caveat a verificar (no bloqueante del diseño):** reconstruir el `NextRequest` para `intlMiddleware` debe preservar el cuerpo de los POST de Server Actions (login, checkout) — el cuerpo lo lee el route/Server Action downstream, no el middleware, así que clonar headers en el middleware no lo consume. La reconstrucción **sólo sobreescribe headers**: nunca leer ni clonar el body (nada de `await request.text()`/`request.clone()` del body), para no consumir el stream. Aun así, la verificación E2E (§10) ejercita login y checkout (ambos POST) y cazaría una regresión de body. **Verificación de implementación**: confirmar la firma concreta para reconstruir un `NextRequest` con headers sobreescritos en el edge runtime (p. ej. `new NextRequest(request, { headers })` vs. envolver un `Request` nativo) — es el único detalle del mecanismo que se cierra al codear; los pasos 1-2 de §5 ya están verificados contra el código instalado.

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
  nonce = btoa(String.fromCharCode(...getRandomValues(16)))
  hdrs  = clone(request.headers) + {content-security-policy: csp(nonce), x-nonce: nonce}
  req'  = NextRequest(request, {headers: hdrs})
  response = intlMiddleware(req')   → next-intl reenvía hdrs al render → Next parsea el CSP-request y firma sus <script> con el nonce
  supabase = createSupabaseMiddlewareClient(request /*original*/, response)  → getUser() refresca cookies sobre response
  branch protegido (getSession()/ACCESS-02): si redirige, el redirect también lleva csp(nonce)
  response.headers['Content-Security-Policy'] = csp(nonce)   // (o -Report-Only según env de rollout)
→ browser ejecuta sólo scripts con nonce (+ los que ésos carguen vía strict-dynamic)
```

## 6. Modelo de datos

Sin cambios al modelo de datos.

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Widget de OnvoPay (riesgo central)**. Comportamiento esperado: el loader (`createElement`) se autoriza por propagación de `strict-dynamic` desde el bundle confiable; el contenido del iframe `*.onvopay.com` no se ve afectado (cae bajo `frame-src`, ya permitido). Verificación obligatoria: un pago real end-to-end sin violaciones de CSP que rompan el flujo. Si rompe el loader, aplicar el fix acotado de §5 (`script.nonce` o `next/script`). No se mergea sin un pago real verde.
- **Render dinámico forzado**. Un nonce por request impide el cacheo estático de la respuesta HTML. **Decisión**: se acepta render dinámico en las respuestas HTML que ya pasan por el middleware (el `matcher` actual `'/((?!api|_next|_vercel|.*\\..*).*)'` ya las cubre); el beneficio de eliminar `'unsafe-inline'` globalmente supera la pérdida de cacheo estático para el volumen de este portal (sin tráfico productivo aún). Los assets (`_next`, estáticos) quedan fuera del matcher y siguen cacheables. Umbral concreto a vigilar (§12): si tras el cutover el TTFB del portal público (`/`, `/tours`) se degrada de forma sostenida respecto a la línea base previa, reconsiderar (p. ej. acotar el matcher del nonce a las rutas que ejecutan scripts inline, dejando estáticas las puramente públicas).
- **Doble header CSP**. Garantizar **una sola** fuente de CSP (toda en el middleware); quitar la de `next.config.ts` para no emitir dos políticas que el navegador intersecaría.
- **Branch de redirect del middleware**. El `NextResponse.redirect` de rutas protegidas también lleva el header CSP. Una 3xx no renderiza HTML ni ejecuta scripts, así que el CSP ahí **no aporta seguridad**; se setea sólo para no tener ramas con/sin header (consistencia y simplicidad del código), no porque el navegador lo necesite. El caso borde que sí importa es el de la respuesta que renderiza HTML (coincidencia nonce header ↔ `<script nonce>`).
- **Refresh de cookies de Supabase**. La integración del nonce no debe descartar la `response` a la que Supabase engancha las cookies; verificar que la sesión sigue refrescándose.
- **Edge runtime**. Usar Web Crypto (`crypto.getRandomValues`), no `node:crypto`; consistente con el patrón edge-safe ya presente.
- **Sentry**. Su init de browser (`web/sentry.client.config.ts`, hoy `enabled` sólo con `NODE_ENV=production` && DSN presente) se bundlea con el cliente de Next, así que el script que lo carga es uno de los `<script>` de Next y hereda el nonce. Bajo `strict-dynamic`, cualquier script que Sentry inyecte dinámicamente se autoriza por propagación desde ese bundle confiable. Si la verificación mostrara que `@sentry/nextjs` necesita el nonce explícito, el SDK expone la opción documentada para pasárselo; se evaluará sólo si la verificación lo exige. La captura real de un error depende de DSN (diferida, §10).
- **Navegadores sin `strict-dynamic`**. Caen al fallback (`https:`/host-allowlist), comportamiento degradado pero no roto.

## 9. Impacto en otras áreas

- **Middleware** (`web/middleware.ts`): cambia para generar/propagar el nonce y setear la CSP; coexiste con el guard de rol (ACCESS-02) y el refresh de Supabase.
- **next.config.ts**: se le quita la CSP (se mueve al middleware); conserva los demás headers de seguridad.
- **Pagos**: área sensible. El cambio afecta cómo se autoriza la carga del SDK de OnvoPay. Requiere `payment-flow-auditor` y un pago real de verificación. Posible cambio acotado en `CheckoutForm.tsx` (sólo si la verificación lo exige).
- **Sin impacto** en DB, worker, emails, i18n ni en la lógica del panel admin.

## 10. Plan de tests

- **Unit (builder de CSP)**: dado un nonce, el string incluye `'nonce-<x>'` y `'strict-dynamic'` en `script-src` y **no** incluye `'unsafe-inline'` en `script-src`; agrega `'unsafe-eval'` sólo cuando `NODE_ENV !== 'production'` **y, como caso negativo explícito, NO lo incluye cuando `NODE_ENV === 'production'`**. Además, **paridad completa con la CSP vigente**: el test afirma que se conservan **todas** las demás directivas del `next.config.ts` actual sin pérdida — `default-src 'self'`, `style-src 'self' 'unsafe-inline'` (residuo aceptado, §3), `img-src 'self' data: https:`, `font-src 'self' data:`, `connect-src 'self' <supabase http> <supabase ws> https://sdk.onvopay.com https://api.onvopay.com https://*.sentry.io`, `frame-src https://sdk.onvopay.com https://*.onvopay.com`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`. Como los orígenes de `connect-src` se derivan en runtime de `NEXT_PUBLIC_SUPABASE_URL` (`supabaseOrigin`/`supabaseWs` en `next.config.ts`), el test debe **inyectar un valor de env de fixture** y verificar que el módulo compartido compone esos orígenes igual que hoy (no afirmar contra strings vacíos ni hardcodear, para que el test no sea frágil). Así una migración no pierde una directiva en silencio.
- **Unit (middleware)**: dado un request, el middleware (a) setea el header **`content-security-policy`** con el nonce en los **request headers** que recibe el render (el mecanismo por el que Next firma sus scripts — no basta `x-nonce`), (b) setea un header `Content-Security-Policy` con el **mismo** nonce en la respuesta, (c) dos requests producen nonces distintos, (d) el branch de redirect también lleva CSP.
- **Unit/regresión (un solo header CSP)**: afirmar que la fuente de CSP es única — que `next.config.ts` ya **no** emite `Content-Security-Policy` (hoy lo emite en `securityHeaders`) y que una respuesta trae exactamente **un** header CSP. Previene reintroducir la doble política (§8) al editar `next.config.ts`.
- **E2E (Playwright)**: navegar portal (`/`), detalle de tour, checkout, login y dashboard; afirmar que la consola no reporta violaciones de CSP ni scripts bloqueados, que el HTML trae `<script nonce="...">` cuyo valor **coincide** con el `'nonce-…'` del header CSP de la respuesta, y que login y checkout (POST de Server Action) siguen funcionando (verifica de paso el caveat de body de §5).
- **Manual (documentado en el PR)**: un pago real con OnvoPay (vía ngrok) completado sin violaciones de CSP. La captura real de un error por Sentry requiere DSN configurado; como hoy no existe DSN de prod, esta verificación queda **explícitamente diferida al checkpoint de observabilidad** (consistente con §4) — se deja registrado en el PR, no bloquea el merge.

## 11. Plan de rollout

- **Una sola política**, cuyo _header_ decide un env (p. ej. `CSP_REPORT_ONLY`): `Content-Security-Policy` (enforcing) por defecto, o `Content-Security-Policy-Report-Only` cuando se quiera observar sin romper. No se emiten dos CSP en paralelo (evita la doble política de §8): es el mismo string nonce+strict-dynamic bajo uno u otro nombre de header. Next firma igual sus scripts en ambos modos (lee el nonce de los dos headers, §5).
- **Consistente con el spec 0016** (que decidió ir a enforcing directo tras validar en build de prod local porque no hay prod aún): el camino por defecto de este spec es **verificar en `pnpm build && start` local + Playwright + pago real** y quedar en **enforcing**. El modo Report-Only queda disponible como herramienta para el eventual cutover a prod real (observar violaciones con tráfico real antes de endurecer), no como paso obligatorio hoy.
- No requiere migración de datos.
- Reversible con un cambio de config (volver a la CSP con `'unsafe-inline'` de `next.config.ts`), sin estado persistente que limpiar.
- Coordinar la verificación del pago real (OnvoPay sandbox + ngrok, como en checkpoints anteriores) antes de promover a enforce en producción.

## 12. Métricas de éxito

- 0 violaciones de CSP en consola/Report-Only en los flujos críticos (portal, checkout, login, admin) durante la ventana de observación.
- `script-src` en producción sin `'unsafe-inline'` (verificable en el header de cualquier respuesta HTML).
- Tasa de éxito de checkout sin regresión tras el enforcing.
- TTFB del portal público (`/`, `/tours`) sin degradación sostenida atribuible al render dinámico del nonce (§8); si la hubiera, aplicar la mitigación de acotar el matcher.

## 13. Preguntas abiertas

- [x] **RESUELTA** — ¿next-intl propaga el nonce hacia el render de Next? **Sí, verificado en el código instalado** (no era `x-nonce` sino el header `content-security-policy` del request): Next extrae el nonce de `headers['content-security-policy']` en `app-render.js`, y next-intl reenvía `new Headers(request.headers)` vía `NextResponse.rewrite/next({ request: { headers } })`. El mecanismo concreto quedó en §5. No requiere spike adicional previo a la implementación.
- [ ] **Pregunta**: ¿El loader de OnvoPay (`document.createElement`) sobrevive a `strict-dynamic` por propagación, o requiere el fix acotado (`script.nonce` / `next/script`)? **Dueño**: kenneth **Antes de**: enforce (se resuelve con el pago real de §10; es el único punto que sólo se confirma en runtime, por eso el criterio de aceptación exige un pago real verde y `payment-flow-auditor`).
