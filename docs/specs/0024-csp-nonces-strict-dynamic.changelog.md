# Changelog — 0024 CSP con nonces por request (strict-dynamic)

Registro vivo de la implementación. Lo más reciente arriba.

## 2026-06-15 — Implementación (rama `feat/0024-csp-nonces`)

Spec aprobado tras 3 rondas de spec-reviewer (la última: "Sin correcciones pendientes").
El spike del mecanismo de propagación del nonce quedó cerrado contra el código instalado:
`next@15.3` lee el nonce del header `content-security-policy` del **request** que llega al
render (`app-render.js`: `getScriptNonceFromHeader`), y `next-intl@4.12` reenvía
`new Headers(request.headers)` al render vía `NextResponse.rewrite/next({ request: { headers } })`.

**Código:**

- `web/lib/security/nonce.ts`: `generateNonce()` edge-safe — `crypto.getRandomValues(16)` +
  `btoa(String.fromCharCode(...))`, sin `node:crypto`/`Buffer` (el middleware corre en edge).
- `web/lib/security/csp.ts`: `buildCsp(nonce)` arma la política; `script-src` pasa de
  `'unsafe-inline'` a `'nonce-<n>' 'strict-dynamic'` (+ `'self' https:` y el sdk de OnvoPay como
  fallback para navegadores sin strict-dynamic). Conserva idénticas las demás directivas
  (`default-src`, `style-src 'unsafe-inline'` —residuo aceptado, §3—, `connect-src` con
  Supabase http+ws/OnvoPay/Sentry, `frame-src` OnvoPay, `frame-ancestors 'none'`, etc.).
  `'unsafe-eval'` sólo fuera de producción. `cspHeaderName()` decide enforcing vs report-only
  según `CSP_REPORT_ONLY` (rollout, §11).
- `web/middleware.ts`: genera el nonce, lo setea en el header `content-security-policy` (y
  `x-nonce`) de un `NextRequest` reconstruido que **sólo** sobreescribe headers (nunca el body
  de los POST de Server Actions) y se lo pasa a `intlMiddleware`; setea la misma CSP en la
  respuesta y en el `NextResponse.redirect` del branch protegido. Supabase sigue usando el
  request **original** (cookies intactas) → el refresh de sesión no cambia.
- `web/next.config.ts`: se elimina la CSP (única fuente ahora es el middleware, evita doble
  header que el navegador intersecaría); conserva HSTS / X-Content-Type-Options /
  X-Frame-Options / Referrer-Policy / Permissions-Policy.
- `web/lib/env.ts` + `web/.env.example`: nueva env `CSP_REPORT_ONLY` (default `false` = enforcing).

**Tests (web unit):** `csp.test.ts` (nonce + strict-dynamic en script-src, **sin** unsafe-inline
en scripts, unsafe-eval sólo en dev / negativo en prod, paridad completa de directivas con
fixture de `NEXT_PUBLIC_SUPABASE_URL`, enforce vs report-only), `nonce.test.ts` (formato base64,
16 bytes, unicidad), `middleware.test.ts` (nonce en el header CSP del request hacia el render +
`x-nonce`, mismo nonce en la respuesta, distinto por request, CSP en el redirect protegido),
`next-config.test.ts` (regresión: `next.config` ya no emite CSP; conserva los demás headers).

**Verificación automática:** typecheck OK (web+worker) · lint 0 errores · web unit **172**
(incluye los +18 de esta feature) · worker unit sin cambios. Sin migraciones de DB.

**Verificación en build de producción + Playwright (CSP enforcing, navegador real).** `next build`

- `next start` (NODE_ENV=production → sin `unsafe-eval`), Supabase local con `db reset` (migraciones
  hasta `…035` + seed). Resultados:

* Header CSP por request confirmado por curl: `script-src 'nonce-<n>' 'strict-dynamic' 'self'
https: https://sdk.onvopay.com` — **sin `unsafe-inline` ni `unsafe-eval`**; nonce distinto por
  request; el redirect `/es`→`/es/tours` y el redirect del guard de panel también llevan la CSP.
* **Next aplica el nonce**: en `/es/tours`, los **20** `<script nonce="…">` del HTML usan TODOS
  exactamente el nonce del header de esa respuesta (mecanismo del spike confirmado en runtime).
* **Portal** (`/es/tours`, detalle, `/en/tours`): hidratan, **0 errores/warnings de consola**.
* **Checkout + OnvoPay (riesgo central §8): RESUELTO.** Con una salida sembrada, se llenó el form
  y se envió (POST de Server Action → el body sobrevivió a la reconstrucción del `NextRequest`):
  se creó el payment intent real en OnvoPay sandbox y el **widget de OnvoPay renderizó completo**
  (campos de tarjeta + iframe `*.onvopay.com`). El SDK (`document.createElement('script')`) cargó
  y ejecutó bajo `strict-dynamic` por propagación de confianza desde el bundle nonceado — **sin
  necesitar `script.nonce`/`next/script`; `CheckoutForm.tsx` no se tocó.** Único error de consola:
  un `429` de `ingest.sentry.io` (rate-limit server-side de Sentry, **no** una violación de CSP;
  de hecho confirma que `connect-src https://*.sentry.io` permite la request).
* **Login + panel admin**: `/es/dashboard` sin sesión → el guard del middleware redirige a
  `/es/login` (redirect con CSP); login de admin (POST) OK; el panel (`/es/dashboard`,
  `/es/dashboard/bookings`) hidrata con **0 errores de consola**.

**Pregunta abierta §13 — RESUELTA**: el loader de OnvoPay sobrevive a `strict-dynamic` por
propagación (verificado con widget renderizado en prod). **Pendiente manual previo al enforce en
prod real** (no bloquea el PR; el usuario provee ngrok y mergea): completar un pago real con
tarjeta + webhook por ngrok, y la captura de error de Sentry con DSN de prod (§10).

**Auditores (antes del PR):**

- `payment-flow-auditor`: **sin riesgos** para el flujo de dinero. La CSP cubre los 3 canales del
  checkout (carga del SDK por strict-dynamic + fallback `https://sdk.onvopay.com`; iframe del
  widget por `frame-src`; `connect-src` a `api.onvopay.com`). El webhook server-to-server es ajeno
  a la CSP (no es navegación de browser + `/api` está fuera del matcher). Adapter pattern intacto.
  No bloqueantes: (a) `script.nonce` defensivo opcional en `CheckoutForm` (el spec ya lo deja como
  "sólo si la verificación lo exige"; la verificación mostró que no hace falta); (b) cuando entre
  PayPal, parametrizar los orígenes de CSP por proveedor en vez de constantes OnvoPay fijas.
- `code-reviewer`: **sin bloqueantes**. Edge-safety correcta, sin strings mágicos, SRP limpia,
  paridad de directivas verificada, tests proporcionales. Follow-up registrado (fuera de alcance,
  **preexistente** — este spec no lo introdujo, sólo agregó el header CSP a ese redirect): en
  `web/middleware.ts redirectToLogin()`, el `NextResponse.redirect` no arrastra las cookies que
  Supabase pudo refrescar en `response`. Impacto práctico bajo (la app es invite-only: sólo
  admin/staff tienen sesión y siempre con rol de panel, así que el branch "authenticated sin rol"
  es defensa en profundidad). Se deja como mejora futura, no se mezcla en este PR.
