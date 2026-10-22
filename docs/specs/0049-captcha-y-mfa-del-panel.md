# 0049 — Captcha en el acceso al panel y segundo factor para admin y staff

- **Estado**: approved
- **Autor**: Kenneth (con Claude Code)
- **Creado**: 2026-10-20
- **Última actualización**: 2026-10-22
- **Rama**: feat/0049-captcha-y-mfa-del-panel
- **PR**: (pendiente)

## 1. Contexto y motivación

La re-auditoría de seguridad del 2026-10-18 (`docs/security-audits/2026-10-18-reauditoria-2.md`, INFRA-01) encontró que los límites de intentos del login y de la recuperación de contraseña (spec 0017) los aplica la app, pero se pueden saltear. La URL de Supabase y la clave publishable son públicas, así que un atacante llama directo a Supabase Auth (`/auth/v1/token?grant_type=password` y `/auth/v1/recover`). Lo único que lo frena es el límite por IP de Supabase, que se esquiva rotando IPs.

Del otro lado del login hay mucho en juego. Una cuenta de admin o staff ve los datos personales de todos los turistas, cancela, reembolsa, cobra y registra devoluciones. Hoy entra con email y una contraseña de 8 caracteres, sin segundo factor.

El spec 0048 dejó este frente fuera de alcance porque tiene otro rollout. Este spec lo cierra con dos defensas que se complementan y se despliegan por separado:

- **Segundo factor obligatorio (TOTP)** para admin y staff. Una contraseña robada, adivinada o reutilizada ya no alcanza. Sale primero: no manda datos a terceros nuevos.
- **Captcha** (Cloudflare Turnstile, por la protección nativa de Supabase Auth) en el login y la recuperación. Frena la fuerza bruta automatizada y el bombardeo de correos, también por llamada directa a Supabase. Sale después, con el aviso de privacidad actualizado (lo mismo que la Fase B del 0048).

Para quién: el operador y su equipo (admin y staff). Los guías no tienen cuenta (entran por enlace) y los turistas no inician sesión.

Revierte la decisión del 2026-09-27 "sin doble factor" (`.claude/memory/decisions.md`); la decisión nueva se registra al aprobar este spec.

## 2. Objetivos

- Exigir un segundo factor (código TOTP de una app autenticadora) a admin y staff para usar el panel y para leer o escribir datos del panel por la API, incluido Storage.
- Permitir que un admin resetee el segundo factor de otro usuario del panel sin que eso le abra la cuenta a quien tenga solo la contraseña.
- Exigir un captcha válido para iniciar sesión con contraseña y para pedir la recuperación, también en las llamadas directas a Supabase Auth.

## 3. Fuera de alcance

- No hay MFA por SMS ni por correo. SMS es pago en Supabase y vulnerable a SIM swapping.
- No hay códigos de respaldo propios. Supabase no los trae, y la recuperación la hace un admin (decisión del operador del 2026-10-20).
- No hay passkeys ni WebAuthn: en Supabase todavía están en beta.
- No se cambia la política de contraseñas. Con segundo factor obligatorio, subirla aporta poco.
- No se corta el acceso de un usuario desactivado antes de que venza su token (ACCESS-1). Va en otro spec.
- No hay captcha en el checkout (Fase B del 0048) ni en `/reset-password`, que ya exige el enlace firmado del correo o la cookie de invitación.

## 4. Historias de usuario

> Como admin o staff, quiero un segundo factor en mi cuenta, para que nadie entre al panel solo con mi contraseña.

- [ ] Después de la contraseña, un admin o staff siempre pasa por `/{locale}/mfa`, tenga o no un factor configurado. Así el login no revela qué cuentas lo tienen.
- [ ] **Sin factor**, `/mfa` muestra el QR, la clave en texto para cargarla a mano y un campo para el primer código. Al verificarlo, la sesión pasa a `aal2` y entra al panel.
- [ ] **Con factor**, `/mfa` pide el código de 6 dígitos. Al verificarlo, entra al panel (o a `redirectTo`, validado con `safeRedirectPath`).
- [ ] Cada vez que se enrola un factor, el usuario recibe un correo: "Se configuró un segundo factor en tu cuenta del panel. Si no fuiste vos, avisale a un administrador." Además queda registrado en `audit_logs` (`user.mfa_enrolled`).
- [ ] Mientras la sesión no sea `aal2`:
  - ninguna página del panel (`/dashboard/**`), server action ni route handler del panel funciona, y el usuario vuelve a `/mfa`;
  - por la API (PostgREST y Storage), las tablas del panel devuelven vacío o rechazan la escritura, aunque el token sea de admin o staff.
- [ ] `/mfa` tiene "Cerrar sesión", para entrar con otra cuenta.
- [ ] Recuperar la contraseña por correo no saltea el segundo factor. Después de elegir la contraseña nueva, el acceso al panel pasa por `/mfa`.

> Como admin, quiero resetear el segundo factor de alguien de mi equipo que perdió el teléfono, sin que eso le deje la cuenta abierta a quien tenga su contraseña.

- [ ] En Usuarios, cada usuario con un factor tiene la acción "Resetear segundo factor", con confirmación. Solo la ve y la usa un admin, y no sobre sí mismo (a un admin lo resetea otro admin).
- [ ] Al resetear:
  - se borran los factores;
  - se reemplaza la contraseña por una aleatoria que nadie conoce;
  - se cierran las sesiones del usuario;
  - se le manda el correo de acceso para elegir una contraseña nueva;
  - queda registrado en `audit_logs` (`user.mfa_reset`, con actor y usuario afectado).
- [ ] Para volver a entrar, el usuario tiene que controlar su correo (contraseña nueva) y después enrolar un factor nuevo. Con solo la contraseña vieja no puede.

> Como operador, quiero que un programa no pueda probar contraseñas contra las cuentas del panel, para que una contraseña débil no alcance para entrar.

- [ ] Los formularios de login y de recuperación muestran el widget de Turnstile (modo Managed) y mandan su token.
- [ ] Sin un captcha válido:
  - el login muestra "No pudimos verificar que sos una persona. Probá de nuevo.";
  - la recuperación muestra la misma respuesta neutra de hoy (anti-enumeración) y no manda el correo.
- [ ] Supabase rechaza una llamada directa a `POST /auth/v1/token?grant_type=password` o a `/auth/v1/recover` que no traiga un `captcha_token` válido.

## 5. Diseño técnico

### 5.1 Segundo factor (TOTP de Supabase Auth)

**Habilitar TOTP**:

- En `supabase/config.toml`: `[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true` (local y CI).
- En producción ya figura "Enabled" (dashboard, 2026-10-19).
- TOTP no tiene costo en Supabase.
- **No se corre `supabase config push`**: el `config.toml` tiene límites de Auth pensados para CI (INFRA-01).

**Nivel de la sesión**: Supabase pone el claim `aal` en el JWT: `aal1` con solo contraseña, `aal2` con el segundo factor verificado. Un token sin `aal` cuenta como no-`aal2`. El `custom_access_token_hook` (…050, líneas 330-336) solo agrega `user_role` sobre `event->'claims'` y preserva `aal` y `amr`.

**Supuestos de GoTrue** (se cubren con tests de integración):

- con un factor verificado, enrolar otro o dar de baja uno exige `aal2`;
- `aal2` solo se obtiene con `verify`.

Toda la defensa contra "contraseña robada más factor propio" se apoya en esos dos supuestos.

**Cuatro capas de enforcement**:

1. **Middleware** (`web/middleware.ts`). En las rutas protegidas ya decodifica `user_role` del token; ahora también `aal`. Si el rol es admin o staff y `aal !== 'aal2'`, redirige a `/{locale}/mfa?redirectTo=…`.
2. **`requireAuth`** (`web/lib/auth/server.ts`).
   - El chequeo de `aal` va **antes** de `getCurrentUser()`, que lee `users` con el cliente `authenticated` y, con la RLS nueva, devolvería `null` para una sesión `aal1` (fallaría como `ACCOUNT_INACTIVE`).
   - Orden: sesión → rol del JWT → si es admin o staff y no `aal2`, `AuthError('MFA_REQUIRED')` → `getCurrentUser()` y `active`.
   - Con esto lo exigen `requireRole`/`requireAnyRole`, y por lo tanto todas las server actions y route handlers del panel.
3. **Layout `(admin)`**: distingue `MFA_REQUIRED` (redirige a `/mfa`) del resto de los errores (a `/login`, como hoy).
4. **Base de datos (RLS)**: política RESTRICTIVE en cada tabla del panel y en `storage.objects` (§6). Es la que cierra el acceso directo por PostgREST y Storage con un token `aal1`.

**Guard de `/mfa`**: helper propio `requirePanelSessionForMfa()`.

- Exige sesión y rol admin o staff tomados del JWT, acepta `aal1` y no lee tablas con RLS.
- No revisa `active`: el hook de …050 ya le niega el token a un usuario desactivado.

**Página `/{locale}/mfa`** (grupo `(auth)`, fuera de `/dashboard`):

- `listFactors()`.
- **Sin factor verificado (enrolamiento)**:
  1. borra los factores sin verificar (`unenroll`) de un intento anterior;
  2. `enroll({ factorType: 'totp', friendlyName: \`Boka Verde ${fecha}\` })`, con un nombre único por intento para evitar `mfa_factor_name_conflict` con dos pestañas;
  3. muestra el QR (SVG) y la clave.
- **Con factor (desafío)**: `challenge` y `verify`.
- **`verify` corre en una server action** (`verifyMfaAction`), no en el navegador. Así se aplica el límite propio por usuario: `RATE_LIMITS.mfaVerifyPerUser = { limit: 10, windowSeconds: 900 }`.
  - Igual, un atacante con la contraseña y un token `aal1` puede llamar directo a `/auth/v1/factors/{id}/verify`. Ahí la barrera es el límite por IP de GoTrue (`token_verifications`) y, con el captcha activo, que cada token `aal1` nuevo exige resolver un captcha. Queda documentado como el mismo patrón de INFRA-01.
- **Al verificar un enrolamiento**: escribe `audit_logs` (`user.mfa_enrolled`) y encola el correo de aviso.

**Login**: después de un `signInWithPassword` exitoso, un admin o staff siempre va a `/mfa?redirectTo=…`.

**Duración de las sesiones `aal1`**:

- En producción está activo "Limit duration of AAL1 sessions" (15 minutos; visto en el dashboard el 2026-10-19).
- Según la semántica de GoTrue, se aplica al renovar la sesión (refresh), no al access token, y solo a usuarios con un factor verificado. Se confirma en la Fase 0.
- Si la sesión vence a mitad de `/mfa`, el usuario vuelve a `/login`.

### 5.2 Reseteo del factor por el admin

**Server action** `resetUserMfaAction(userId)` en `web/lib/users/`:

- Exige `requireRole(Admin)` (y por lo tanto `aal2`) y rechaza `userId === admin.id`.
- Con el cliente de servicio, en este orden:
  1. `auth.admin.mfa.listFactors({ userId })` y `deleteFactor` de cada uno;
  2. `auth.admin.updateUserById(userId, { password: <32 bytes aleatorios> })`, que invalida la contraseña vieja;
  3. cierra las sesiones del usuario (ver abajo);
  4. manda el correo de acceso con el mismo camino que el reenvío de acceso (`resend-invite.ts`, que llama a `resetPasswordForEmail` con el cliente de servicio);
  5. escribe `audit_logs` (`user.mfa_reset`).
- Es idempotente: un segundo reseteo concurrente encuentra cero factores, vuelve a cambiar la contraseña y a mandar el correo, y no falla.

**Cerrar las sesiones por usuario**: supabase-js no documenta un "cerrar todas las sesiones de un usuario" para el admin (`auth.admin.signOut` pide el JWT del usuario). Plan:

- **Preferido**: función SECURITY DEFINER `revoke_user_sessions(p_user_id uuid)` que hace `DELETE FROM auth.sessions WHERE user_id = p_user_id`. Las filas de `auth.refresh_tokens` caen en cascada. Ejecutable solo por service_role.
- **Fase 0**: confirmar que el owner de la migración tiene DELETE sobre `auth.sessions` en el Supabase alojado.
- **Fallback**: `updateUserById(userId, { ban_duration: '1h' })` y después quitar el ban. Antes hay que confirmar que los refresh tokens viejos no vuelven a servir.
- En los dos casos, el access token ya emitido sigue valiendo hasta que vence (`jwt_expiry`, 1 h). Es el mismo límite que ACCESS-1, y queda documentado. Igual, ese token ya no es `aal2` útil por mucho tiempo, porque la contraseña cambió y no se puede renovar.

**UI**: botón "Resetear segundo factor" en `/dashboard/users`, con el diálogo de la marca (spec 0042). Solo se muestra si el usuario tiene algún factor. Para saberlo, la lista de usuarios suma `has_mfa`, con `auth.admin.mfa.listFactors` por usuario; con pocos usuarios, alcanza.

**Auditoría**:

- `AuditEntityType.User = 'user'` (nuevo), con `entity_id` igual al id del usuario afectado.
- Acciones nuevas: `user.mfa_reset` y `user.mfa_enrolled`, sin datos de los factores.
- La escritura es best-effort, como el resto de los eventos fuera de las transacciones de dinero (convención de …018).

### 5.3 Captcha (Supabase Auth + Turnstile)

**Servicio**: Cloudflare Turnstile, modo Managed.

- Verificación de servicio externo del 2026-10-19 (external-service-validator), registrada en `.claude/memory/decisions.md` (entrada 2026-10-20, spec 0048). Fuentes: developers.cloudflare.com/turnstile/plans, cloudflare.com/turnstile-privacy-policy, supabase.com/docs/guides/auth/auth-captcha.
- Acá la modalidad es otra: la validación la hace Supabase con el secreto guardado en Supabase, no un `siteverify` propio. Se anota en la decisión nueva.
- Widget aparte del del checkout. Su sitekey va en `NEXT_PUBLIC_TURNSTILE_AUTH_SITE_KEY`.

**Enforcement**: se activa en el dashboard de Supabase de producción (Attack Protection → Turnstile).

- Supabase exige `captcha_token` en el grant `password` y en `/recover`, `/otp`, `/magiclink` y `/resend`.
- No lo exige en `refresh_token`, `pkce` ni `verify` de factores.

**Cliente**: `TurnstileWidget` (el del 0048, o el mismo patrón si este spec va primero), con `action` `login` o `recover`. Pide el token al enviar.

- **Login** (`login/actions.ts`): lee `cf-turnstile-response` del FormData y llama `signInWithPassword({ email, password, options: { captchaToken } })`. Los límites propios (spec 0017 y el de email+IP de la re-auditoría) siguen antes.
- **Recuperación** (`ForgotPasswordForm.tsx`, en el navegador por PKCE): pasa `captchaToken` a `resetPasswordForEmail`. La página server le pasa el flag como prop, porque `AUTH_CAPTCHA_ENABLED` no es `NEXT_PUBLIC_`.
- **Reenvío de acceso y reseteo del factor** (cliente de servicio): hay que confirmar en la Fase 0 que la clave service_role exime del captcha. Si no, se pasa a `auth.admin.generateLink({ type: 'recovery' })` más el envío del correo, que es API de admin.

**Flag `AUTH_CAPTCHA_ENABLED`** (`true`/`false`, por defecto `false`): decide si el widget se renderiza y si el token viaja. El enforcement es de Supabase, así que importa el orden de rollout y rollback (§11).

**CSP**: `frame-src https://challenges.cloudflare.com` en `/login` y `/forgot-password`, con el patrón por ruta del 3DS.

**Local y CI**: `[auth.captcha]` sigue comentado en `config.toml`. Los tests que inician sesión con contraseña siguen andando sin captcha.

### 5.4 Alternativas consideradas

- **Solo captcha**: no protege contra una contraseña filtrada o reutilizada.
- **Solo MFA**: no frena el bombardeo de `/recover` ni la carga contra GoTrue.
- **Exigir `aal2` solo en la app**: un token `aal1` leería todo por PostgREST y Storage.
- **Reseteo del factor sin tocar la contraseña**: quien tenga la contraseña enrola su propio factor (revisión del spec, 2026-10-20). Descartado por el operador.
- **hCaptcha**: descartado en la verificación del servicio.

## 6. Modelo de datos

**Políticas RESTRICTIVE** (`…_require_aal2_for_panel`):

- **Acción**: create policy, `AS RESTRICTIVE FOR ALL TO authenticated`.
- **Expresión** (patrón InitPlan de …009/…032), con el mismo `WITH CHECK`:

  ```
  (select auth.jwt() ->> 'aal') = 'aal2'
  OR coalesce((select auth.jwt() ->> 'user_role'), '') NOT IN ('admin','staff')
  ```

- **Tablas** (inventario cerrado de las políticas `TO authenticated` en `supabase/migrations/`):
  - `public`: `users`, `tours`, `tour_pricing`, `tour_schedules`, `tour_instances`, `bookings`, `payments`, `notifications`, `refunds`, `audit_logs`, `business_settings` y `tour_instance_guides`;
  - `storage.objects`, por las políticas `tour_images_admin_*` de …050. El panel sube y borra fotos desde el navegador (`TourImageUpload.tsx`).

Ninguna política de esas tablas usa subconsultas a otras tablas (todas leen el JWT), así que la RESTRICTIVE no rompe lecturas cruzadas. Las políticas `TO anon` no aplican a un token `authenticated`. El portal público usa un cliente anon sin cookies, así que un staff `aal1` con la sesión abierta sigue viendo el catálogo como cualquier visitante. Lo único que tiene sin `aal2` es lo que ve un anónimo, y es aceptable.

**Función**: `revoke_user_sessions(p_user_id uuid)`, SECURITY DEFINER, `search_path = ''`, solo service_role (§5.2). Si la Fase 0 la descarta, no se crea.

**Constantes**: `AuditEntityType.User`, `AuditAction.UserMfaReset`, `AuditAction.UserMfaEnrolled` en `shared/constants/audit.ts`. `audit_logs` no tiene CHECK sobre `action` (…018).

**Migración**: `supabase/migrations/20261021000064_mfa_obligatorio_del_panel.sql`.

## 7. Estados y transiciones

Sesión del panel:

- `aal1` → `aal2` al verificar un código TOTP en `/mfa` (desafío o primer enrolamiento).
- Cualquier sesión → cerrada al cerrar sesión, al resetear el factor o cuando vence (el refresh de una `aal1` con factor verificado se corta a los 15 minutos).

No hay estados nuevos en las tablas del negocio.

## 8. Casos borde y errores

- **Factor sin verificar** de un intento anterior: `/mfa` lo borra y empieza de nuevo.
- **Dos pestañas enrolando a la vez**: el nombre del factor es único por intento, así que no hay conflicto. Gana la primera en verificar, y la otra encuentra un factor verificado y pasa a desafío.
- **Código incorrecto o vencido**: "El código no es válido. Probá con el que muestra ahora la app." A los 10 intentos en 15 minutos: "Demasiados intentos. Esperá unos minutos."
- **Reloj del teléfono desfasado**: la ventana de TOTP de Supabase es de ±30 s. El mensaje sugiere revisar la hora del teléfono.
- **Un admin pierde el teléfono**: lo resetea otro admin. Si todos lo perdieron, se resetea desde el dashboard de Supabase (Authentication → Users → MFA factors). Va en el runbook.
- **Dos admins resetean al mismo usuario a la vez**: es idempotente (§5.2) y llegan dos correos de acceso; vale el último enlace.
- **Reseteo mientras el usuario está enrolando**: el reseteo borra también el factor sin verificar y cierra la sesión, y el enrolamiento en curso falla al verificar. El usuario vuelve a `/login` y la contraseña vieja ya no sirve.
- **Recuperación de contraseña**:
  - el correo usa `/auth/confirm` con `token_hash` y `/reset-password` fija la contraseña con el cliente de servicio por la cookie `invite_set` (specs 0010 y 0016);
  - la rama de autoservicio (`updateUser` en `reset-password/actions.ts`) sigue viva por `/auth/callback`; hay que confirmar en la Fase 0 si GoTrue rechaza el cambio con `aal1` cuando hay un factor (`insufficient_aal`), y si lo rechaza, esa rama pasa a usar también el cliente de servicio;
  - en los dos casos, después el acceso al panel cae en `/mfa`.
- **Invitación nueva**: fija la contraseña desde el correo y enrola en el primer acceso. El correo de aviso del enrolamiento le llega igual.
- **Primer despliegue**: nadie tiene factor todavía. Hasta que cada persona enrole, quien tenga su contraseña podría enrolar primero. Mitigación:
  - el equipo enrola el mismo día del despliegue (§11);
  - el correo de aviso y la auditoría de `user.mfa_enrolled` dejan rastro;
  - ante un enrolamiento ajeno, el admin resetea el factor (y con eso cambia la contraseña).
- **Usuario desactivado con sesión `aal2` viva**: igual que hoy (ACCESS-1).
- **Captcha**:
  - vencido (más de 300 s): el widget pide uno nuevo;
  - Cloudflare caído: nadie del panel puede iniciar sesión, pero las sesiones abiertas siguen (el refresh no lo exige) y el admin puede apagar el toggle (§11);
  - bloqueador que impide el iframe: el mensaje sugiere desactivarlo.
- **Tests de integración**: con la RESTRICTIVE, las sesiones `aal1` reales quedan sin datos. Los afectados son 15 archivos de `web/tests/integration/`:
  - `auth`, `booking-cutoff`, `business-settings`, `fixed-tours-schema`;
  - `operator-settings-action`, `privacy-notice-data`, `reports`, `retention-anonymization`;
  - `rpc-execute-grants`, `settings-action`, `table-grants`, `terms-publication`;
  - `tour-charge-timing-action`, `tour-schedule-validity-action`, `users-rls`.

  Los que mockean `@/lib/auth/server` no se rompen.
  - **Helper nuevo** `signInAal2(db, email, password)`:
    1. borra los factores del usuario con la API de admin;
    2. inicia sesión;
    3. enrola;
    4. calcula el código con un TOTP propio de ~20 líneas sobre `node:crypto` (RFC 6238, sin dependencia nueva);
    5. verifica.
  - Es idempotente sobre los usuarios del seed y las suites ya corren en serie (`fileParallelism: false`).
  - Los tests de rechazo usan una sesión `aal1`.

## 9. Impacto en otras áreas

- **Panel**:
  - página `/mfa` (enrolamiento, desafío, cerrar sesión);
  - el login redirige a `/mfa`;
  - "Resetear segundo factor" en Usuarios.
- **Emails**: correo nuevo de aviso de enrolamiento (ES y EN), por la cola de `notifications` del worker o con Resend directo desde la server action, lo que use hoy el panel para correos fuera de reservas. El reseteo reusa el correo de acceso.
- **Worker**: solo si el aviso va por la cola (plantilla nueva). Usa service_role, que saltea la RLS.
- **Reportes, pagos y reembolsos**: sin cambios de lógica.
- **i18n**: textos en ES y EN para `/mfa`, los errores del código, el captcha, el reseteo y el correo.
- **Legal**:
  - el aviso de privacidad dice "Sin doble factor" (decisión del 2026-09-27) y hay que actualizarlo con el MFA (sin datos a terceros: TOTP no sale de Supabase);
  - la mención de Turnstile en el acceso del panel va junto con la de la Fase B del 0048.
- **Desarrollo local**: con TOTP activo, cada dev enrola en su primer acceso al panel local, y `supabase db reset` borra los factores.
- **Runbook**: sección nueva en `docs/operacion/` sobre cómo resetear el factor de un admin desde el dashboard de Supabase.
- **Variables de entorno nuevas**:
  - `NEXT_PUBLIC_TURNSTILE_AUTH_SITE_KEY` y `AUTH_CAPTCHA_ENABLED`;
  - las dos van en `web/.env.example` y `web/lib/env.ts`;
  - el secreto del captcha vive en Supabase.
- **Auditoría**: con el captcha queda cubierto INFRA-01, y con el MFA, el riesgo de fondo de INFRA-02 (contraseña sola).

## 10. Plan de tests

- **Unit**:
  - `requireAuth` con una sesión `aal1` de admin o staff devuelve `MFA_REQUIRED` y no `ACCOUNT_INACTIVE`; con `aal2`, pasa;
  - el layout redirige a `/mfa` ante `MFA_REQUIRED`;
  - el middleware redirige a `/mfa` con `aal1` y con un token sin claim `aal`, y deja pasar con `aal2`;
  - un login exitoso de admin o staff siempre va a `/mfa`, tenga o no un factor;
  - `safeRedirectPath` en el `redirectTo` de `/mfa`;
  - el login manda `captchaToken` solo con el flag encendido;
  - el TOTP propio del helper contra los vectores de prueba del RFC 6238.
- **Integración (RLS y Storage)**:
  - con una sesión de staff `aal1`, cada tabla de §6 devuelve vacío o rechaza la escritura; con `aal2`, igual que hoy;
  - `report_*` devuelven vacío con `aal1`;
  - con `aal1`, un upload a `tour-images` lo rechaza Storage;
  - test no enumerativo: recorre `pg_policies` de `public` y `storage` (roles `{authenticated}` y `{public}`) y exige la RESTRICTIVE de `aal2` en toda tabla con políticas para usuarios autenticados.
- **Integración (GoTrue)**:
  - con `aal1` y un factor verificado, enrolar otro factor falla y dar de baja el existente falla;
  - el JWT después de `verify` trae `aal = 'aal2'` y `user_role`.
- **Integración (acciones)**:
  - `verifyMfaAction` respeta `mfaVerifyPerUser`;
  - el enrolamiento audita `user.mfa_enrolled` y encola el aviso;
  - `resetUserMfaAction`:
    - como admin, borra los factores, invalida la contraseña (el login viejo falla), cierra las sesiones, manda el correo de acceso y audita;
    - como staff, se rechaza;
    - sobre uno mismo, se rechaza;
    - dos veces seguidas, no falla;
  - `/mfa` borra el factor sin verificar de un intento anterior;
  - con `aal1`, las server actions del panel devuelven no autorizado.
- **Manual (PR)**:
  1. enrolar con Google Authenticator;
  2. entrar con el código;
  3. probar un código incorrecto;
  4. resetear el factor desde otro admin y recuperar el acceso por correo;
  5. login en un preview con la sitekey de prueba de Turnstile.

## 11. Plan de rollout

**Fase 0** (en local y en un proyecto de Supabase de prueba, o en un preview según §13):

1. DELETE sobre `auth.sessions` desde la migración, o el fallback del ban (§5.2).
2. Que "Limit duration of AAL1 sessions" se aplique al refresh y solo con un factor verificado.
3. Si `updateUser` con `aal1` y un factor da `insufficient_aal`.
4. Que la clave service_role exima del captcha en `resetPasswordForEmail`.
5. `remoteip` del login por server action con el captcha.
6. La CSP en report-only.

**MFA** (sale primero, sin flag, porque es una regla de seguridad):

1. Desplegar la web con `/mfa`, el chequeo de `aal2` en el middleware y en `requireAuth`, y el reseteo. Sin la RLS nueva esto ya es seguro, y el panel exige el segundo factor.
2. Avisar al equipo y enrolar todos el mismo día.
3. Verificar que todos tengan un factor (Usuarios muestra `has_mfa`).
4. Recién entonces aplicar la migración …064. Aplicarla antes deja sin datos a las sesiones `aal1` hasta que se enrolen.

**Captcha** (detrás de `AUTH_CAPTCHA_ENABLED`, con el aviso actualizado):

1. Publicar el aviso de privacidad actualizado.
2. Crear el widget del acceso en la cuenta de Cloudflare del operador y guardar el secreto en Supabase, todavía sin activar.
3. Cargar la sitekey y `AUTH_CAPTCHA_ENABLED=true` en Vercel y desplegar. El token viaja, pero Supabase todavía no lo exige.
4. Activar Turnstile en Supabase.
5. Confirmar en el dashboard que los rate limits de Auth siguen bajos.

**Rollback**:

- **Captcha**: primero apagar el toggle de Supabase y después `AUTH_CAPTCHA_ENABLED=false`. Al revés, el login falla en el medio.
- **MFA**: primero una migración nueva con DROP de las RESTRICTIVE (el proyecto es forward-only) y después revertir la web. Si se revierte la web primero, el login sin MFA deja el panel sin datos. Los factores enrolados quedan y no molestan.

**Comunicar al operador**:

- que cada persona necesita una app autenticadora (Google Authenticator, Microsoft Authenticator o 1Password);
- el día del enrolamiento;
- cómo se resetea un factor perdido (y que eso cambia la contraseña);
- que siempre tiene que haber al menos dos admins activos.

## 12. Métricas de éxito

- El 100 % del equipo enrolado a los 7 días del despliegue del MFA (Usuarios, `has_mfa`).
- El 100 % de las sesiones que leen datos del panel son `aal2` (lo garantiza la RLS, verificado por el test de `pg_policies`).
- Cero logins con contraseña sin captcha aceptados después de activar el toggle (logs de Supabase Auth, retención de 7 días en Pro).

## 13. Preguntas abiertas

- [ ] **Pregunta**: ¿A qué proyecto de Supabase apuntan las previews de Vercel? Si es el de producción, el captcha del widget de producción no valida en sus hostnames, y la Fase 0 no se puede hacer en un preview. Opciones: agregar el hostname de preview al widget, un proyecto de staging, o hacer la Fase 0 solo en local con las claves de prueba de Turnstile. **Dueño**: Kenneth **Antes de**: 2026-10-27
- [ ] **Pregunta**: ¿La abogada actualiza el "Sin doble factor" del aviso, junto con la mención de Turnstile? **Dueño**: abogada **Antes de**: el despliegue del captcha
- [ ] **Pregunta**: ¿Quién es el segundo admin y cuándo se crea? Sin él, la recuperación de un admin pasa por el dashboard de Supabase. **Dueño**: Kenneth **Antes de**: el despliegue del MFA
