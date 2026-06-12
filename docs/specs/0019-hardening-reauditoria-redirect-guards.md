# 0019 — Hardening de la 3ra auditoría: open-redirect, guard de panel y cierre de is_public_request (retrospectivo)

- **Estado**: implemented
- **Autor**: claude (3ra auditoría de seguridad completa)
- **Creado**: 2026-06-11
- **Última actualización**: 2026-06-11
- **Rama**: fix/security-hardening-redirect-guard-isd
- **PR**: (pendiente)

> Spec **retrospectivo**: documenta los hallazgos de la tercera auditoría de seguridad
> completa (revisión estática desde cero + pentest activo contra el stack vivo) y los
> fixes implementados en el mismo PR. Se escribe después del código porque fueron
> correcciones de hardening de bajo riesgo, siguiendo la convención de spec
> retrospectivo del proyecto (ver 0018).
>
> **Nota de rama**: el nombre `fix/security-hardening-redirect-guard-isd` se desvía del
> patrón `feat/<id>-<slug>` por ser un hotfix de hardening agrupado, igual que la
> desviación documentada en 0018 §13.

## 1. Contexto y motivación

Se hizo una **tercera auditoría de seguridad COMPLETA**, re-evaluando todo desde cero
(ignorando los veredictos de las auditorías 1 y 2) y re-verificando cada control
empíricamente con un pentest activo contra el stack local (Supabase + Next corriendo).

**Veredicto general: la base es sólida.** Los críticos de las auditorías previas están
correctamente remediados y re-verificados en vivo:

- Las 8 funciones `SECURITY DEFINER` privilegiadas devuelven `401 permission denied`
  para `anon` y `authenticated` (fix 0018 confirmado contra el stack vivo).
- RLS bloquea toda lectura/escritura anon de tablas sensibles (bookings/payments/
  refunds/notifications/audit_logs/tokens/rate_limits → `[]` o 401).
- Precio autoritativo server-side (0015), validación de monto del webhook (0014),
  refunds server-side, rate-limiting (0017), CSV anti-fórmula (0016), headers/CSP,
  tokens 256-bit + SHA-256, audit_logs append-only (inmutable incluso para
  service_role), `pnpm audit` limpio — todo re-verificado.
- Pentest de escalada: `staff` no puede cambiar su rol, ni leer la PII de admin/otros
  staff, ni modificar a otros usuarios, ni ejecutar funciones de dinero (403).
- Pivote por embedding de PostgREST (anon ↔ bookings vía relaciones) → RLS lo vacía.

No se encontró ningún hallazgo **crítico ni alto** nuevo. Sí aparecieron **3 de
severidad baja** (criterio cualitativo por impacto, no CVSS; solo F-1 tiene impacto de
explotación real, F-2/F-3 son defensa en profundidad). Este spec los cierra.

## 2. Objetivos

- **F-1**: cerrar el bypass del guard de open-redirect (`safeRedirectPath`) mediante
  caracteres de control que el parser de URL elimina.
- **F-2**: hacer explícita la autorización por rol del panel admin en un único
  choke-point, sin depender solo de RLS.
- **F-3**: cerrar la ejecución de `is_public_request()` por `anon`/`authenticated` por
  consistencia con el patrón least-privilege del proyecto.
- No alterar ningún camino legítimo (login/checkout/panel para admin/staff,
  invocación de funciones por `service_role`).

## 3. Fuera de alcance

- Los **riesgos residuales conocidos** re-confirmados (§9), que NO son nuevos: secreto
  estático del webhook OnvoPay, CSP `unsafe-inline`, IP del checkout spoofeable según
  config de Vercel, DoS dirigido por límite de email, magic links reusables. Se
  documentan pero no se tocan acá.
- Endurecer la CSP a nonces (M-2 diferido, 0016).
- Cualquier cambio en pagos, schema de datos de negocio, o servicios externos.

## 4. Historias de usuario

- **Como** atacante, **intento** que un usuario logueado termine en un host externo
  inyectando `?redirectTo=%2F%09%2Fevil.com` en el login, **pero** el server descarta
  el destino y usa el fallback local (F-1).
  - _Criterio_: `safeRedirectPath` con tab/LF/CR/NUL/DEL o backslash → devuelve el
    fallback; rutas locales legítimas (incl. query strings) → se aceptan.
- **Como** principal autenticado sin rol de panel, **intento** cargar `/dashboard/*`,
  **pero** el layout me redirige a `/login` (F-2).
  - _Criterio_: admin/staff entran al panel sin cambios; cualquier otro caso → redirect.
- **Como** atacante con la anon key, **intento** ejecutar `is_public_request()` vía
  PostgREST, **pero** recibo `401 permission denied` (F-3).
  - _Criterio_: anon/authenticated → 401; service_role y las funciones DEFINER que la
    usan internamente → siguen operando.

## 5. Diseño técnico

**F-1 — `web/lib/auth/safe-redirect.ts`.** El guard previo (0016, M-1) tenía tres
checks: `!startsWith('/')`, `startsWith('//')`, `startsWith('/\\')`. Un valor
`"/\t/evil.com"` los pasa los tres (el 2º carácter es un tab, no `/` ni `\`), y el
parser de URL (WHATWG) — que usan tanto el navegador como el router de Next — **elimina**
tab/LF/CR antes de resolver, colapsándolo a `//evil.com` → host externo. PoC verificado:
`new URL("/\t/evil.com", "https://app")` → `https://evil.com/`.

Fix: se reemplaza el check `startsWith('/\\')` por un escaneo `hasUnsafeRedirectChar`
que rechaza cualquier carácter de control (`0x00–0x1f`, `0x7f`) o backslash (`0x5c`) en
**cualquier** posición. Se implementa con `charCodeAt` (sin caracteres de control
literales en el fuente). Quedan los checks de `/` inicial y `//`.

**F-2 — `web/app/[locale]/(admin)/layout.tsx`.** Antes, el layout solo llamaba
`getCurrentUser()` (para la nav). La autorización por rol estaba en `reports`
(`requireAnyRole(ADMIN_PANEL_ROLES)`) y `users` (`requireRole(Admin)`), pero NO en
`bookings`/`departures`/`tours` (que dependían de RLS + del hecho de que solo
admin/staff pueden loguearse). Fix: el layout llama
`requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null)` y, si falla, `redirect('/login')`.
Es un único choke-point para todo el shell; `users` conserva su `requireRole(Admin)`.

**F-3 — migración `20260611000030`.** `REVOKE EXECUTE ON FUNCTION
public.is_public_request() FROM anon, authenticated;`. La función es `SECURITY INVOKER`
y se invoca solo desde dentro de las funciones de dinero (que corren como su owner) y
desde `service_role`, así que el revoke no rompe ningún camino.

**F-3 (red de regresión) — migración `20260611000031`.**
`audit_public_executable_functions()`: auditoría no enumerativa AMPLIA que lista toda
función de `public` ejecutable por `anon`/`authenticated`, excluyendo (1) funciones de
trigger (return type `trigger`, no invocables como RPC) y (2) una allowlist explícita de
funciones intencionalmente públicas (hoy solo los `report_*` para `authenticated`). El
test exige 0 filas → cubre el agujero que dejaba `secdef_functions_public_executable()`
(solo DEFINER). Complementa, no reemplaza, a esa auditoría.

### Diagrama de capas

No aplica (cambios puntuales en helpers/guards existentes, sin nuevas capas).

## 6. Modelo de datos

No aplica. F-3 no agrega ni altera tablas/columnas; solo revoca un grant de ejecución
sobre una función existente. F-1/F-2 son capa de aplicación.

## 7. Estados y transiciones

No aplica. Ningún fix introduce o modifica máquinas de estado.

## 8. Casos borde y errores

- **F-1**: rutas locales con caracteres legítimos (`/evil.com` sin barra extra,
  query strings con `?`, `=`, `&`) deben **seguir aceptándose** (cubierto por test).
  Espacio `0x20` NO se rechaza (no es carácter de control; el parser lo percent-encodea
  → same-origin). Backslash interno (`/es\evil.com`) → rechazado.
- **F-2**: usuario inactivo (`active=false`) → `requireAuth` ya lanza
  `ACCOUNT_INACTIVE` → el `.catch` lo trata como no autorizado → redirect. Admin en
  `/dashboard/users` → el layout pasa, y la página suma su `requireRole(Admin)`.
- **F-3**: la función invocada por `service_role` directamente (no la usa la app, pero
  el test lo cubre) → sigue 200; invocada dentro de `confirm_booking` & co. → sigue
  resolviendo (owner del DEFINER conserva EXECUTE).

## 9. Impacto en otras áreas

- **Riesgos residuales conocidos re-confirmados (NO nuevos, fuera de alcance):**
  - Webhook con secreto estático (no HMAC del body): si se filtrara → bypass de pago.
    Limitación de OnvoPay; mitigada con env-only + constant-time + HTTPS.
  - CSP `script-src 'unsafe-inline'` (sin nonce) — M-2 diferido (0016).
  - Checkout limita solo por IP: spoofeable si Vercel antepende `XFF`; el límite por
    email es el backstop; Vercel Firewall es la mitigación de borde (cutover).
  - Rate-limit por email → DoS dirigido del reset/login de una víctima.
  - Staff puede editar su propio email/phone/active (sin escalada; rol pineado por RLS).
  - Magic links reusables hasta expirar (B-5, riesgo aceptado).
- **Cutover a producción**: la migración F-3 (`…030`) se suma a las migraciones de
  seguridad que deben desplegarse a la DB de prod junto con `…028`/`…029` (ver
  pre-production-checklist). F-1/F-2 son capa de aplicación (se despliegan con la app).
- **Roadmap/memoria**: el snapshot del roadmap decía "no quedan hallazgos abiertos" tras
  la 2da auditoría; al mergear esto, actualizarlo (3 hallazgos LOW cerrados). El gotcha
  de `REVOKE FROM PUBLIC` insuficiente ya se repitió 2× (0018 y F-3 acá) → candidato a
  entrada en la memoria de aprendizajes vía memory-curator.

## 10. Plan de tests

- **F-1 (cobertura automatizada)**: `web/lib/auth/safe-redirect.test.ts` agrega casos
  de tab/LF/CR/NUL/DEL y backslash interno → fallback; y confirma que rutas locales
  legítimas se aceptan. _Alcance_: prueba el rechazo en `safeRedirectPath` (la unidad),
  NO la no-explotabilidad end-to-end del flujo `redirect()`→navegador (esa se valida con
  el PoC manual de la auditoría).
- **F-2 (gap declarado)**: el guard del layout se valida **solo con Playwright**
  (regresión manual en navegador real: admin/staff entran, panel completo OK). NO hay
  test automatizado del path de denegación (un rol no-panel → redirect), porque los
  únicos roles que pueden autenticarse hoy son admin/staff. Gap conocido y aceptado.
- **F-3**: re-pentest en vivo (anon → 401; service_role y funciones de dinero → operan)
  - suite de integración `rpc-execute-grants`. El gap de regresión (la auditoría
    `secdef_functions_public_executable()` solo cubre `SECURITY DEFINER`, no INVOKER) se
    **cerró** con la migración `…031` `audit_public_executable_functions()`: auditoría
    AMPLIA (DEFINER + INVOKER, no enumerativa) con allowlist de las funciones
    intencionalmente públicas (`report_*`) y exclusión de triggers. Tests nuevos: pin de
    `is_public_request` (anon/auth → 401) + aserción de que la auditoría amplia da vacío.
    Demostrado en vivo: al re-otorgar EXECUTE a anon, la auditoría amplia lo lista y la
    vieja no (ver §13).
- **Regresión global** (tras `supabase db reset`, 31 migraciones): web unit **139**,
  web integ **151**, worker unit **64**, worker integ **16**; lint 0 err; typecheck OK.

## 11. Plan de rollout

- Forward-only. Merge a `dev` vía PR (lo aprueba el usuario). La migración `…030` se
  aplica con el siguiente `db reset`/`migration up`; en prod, parte del lote de cutover.
- Sin feature flag ni migración de datos. Reversible revirtiendo el commit (F-1/F-2) o
  re-GRANT (F-3, no recomendado).

## 12. Métricas de éxito

- 0 redirects a host externo desde el login (F-1).
- Páginas del panel devuelven redirect a `/login` para principales sin rol de panel (F-2).
- `POST /rest/v1/rpc/is_public_request` como anon → 401 en prod tras el deploy (F-3).
- Sin regresión funcional en el panel ni en el checkout (Playwright + suites verdes).

## 13. Preguntas abiertas

- **¿F-1 se suma a `pre-production-checklist` como bloqueante de cutover?** Es
  explotable en prod (la ruta `redirectTo` viaja por query), aunque `main` no alimenta
  producción todavía. El fix ya está en este PR, así que se resuelve al promover; queda
  decidir si se trackea explícitamente.
- ~~**¿Se extiende `secdef_functions_public_executable()` para cubrir helpers
  `SECURITY INVOKER`?**~~ **RESUELTO** en este PR (migración `…031`,
  `audit_public_executable_functions()`): auditoría AMPLIA que cubre DEFINER + INVOKER
  con allowlist explícita (`report_*`) y exclusión de triggers; test de integración
  exige 0 filas. Demostrado en vivo que atrapa un re-GRANT a anon de `is_public_request`
  (la auditoría vieja, solo-DEFINER, no lo veía). La regla pasa de "evaluar" a "guardia
  activa en CI". **Decisión de diseño**: la allowlist se mantiene a mano — agregar una
  función pública legítima nueva obliga a sumarla (acto deliberado y reviewable, no un
  olvido silencioso).
