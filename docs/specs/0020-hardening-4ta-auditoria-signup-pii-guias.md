# 0020 — Hardening de la 4ta auditoría: cierre de auto-registro y PII de guías

- **Estado**: approved
- **Autor**: claude (4ta auditoría de seguridad completa)
- **Creado**: 2026-06-12
- **Última actualización**: 2026-06-12
- **Rama**: fix/0020-hardening-signup-pii-guias (cuando aplique)
- **PR**: (pendiente)

## 1. Contexto y motivación

Se hizo una **cuarta auditoría de seguridad COMPLETA** (revisión estática desde cero por
límites de confianza + OWASP, ignorando veredictos previos) seguida de un **pentest activo**
contra el stack vivo (Supabase/PostgREST local). Veredicto general: la base sigue sólida;
los críticos de las auditorías 1–3 están remediados y se re-verificaron empíricamente (las 9
funciones privilegiadas → 401 para anon; RLS bloquea lectura/escritura anon de tablas
sensibles; integridad de precios intacta; auditorías de regresión vacías; audit_logs
inmutable; `pnpm audit` limpio; sin secretos en el repo).

El pentest halló **una vulnerabilidad nueva de severidad MEDIA** que las auditorías previas
no cubrieron, porque surge de la **combinación de dos condiciones independientes**:

1. **Supabase Auth permite auto-registro** (`enable_signup = true`). La app es _invite-only_
   (el admin crea los usuarios con `inviteUserByEmail`) y **no tiene UI de registro**, así
   que ningún usuario debería poder auto-registrarse. En Supabase hosted el signup viene
   habilitado por defecto.
2. **La política RLS `users_select_authenticated` expone TODA fila `role='guide'` a
   cualquier sesión `authenticated`**, no solo a admin/staff. El término `OR role='guide'`
   se introdujo en el spec 0016 (B-4) para que el panel de salidas liste guías, pero alcanza
   a cualquier principal autenticado, no solo a los del panel.

Combinadas, permiten el siguiente ataque (verificado en vivo):

- `POST /auth/v1/signup` con un email cualquiera → devuelve un `access_token` válido con rol
  `authenticated` y sin `user_role` (no hay fila en `public.users`).
- Con ese token + la anon key (pública, viaja en el bundle del browser):
  `GET /rest/v1/users?select=*` → **devuelve la PII de los guías** (nombre completo, email,
  teléfono).

Impacto: cualquier persona en internet puede auto-registrarse y leer los datos personales de
los guías del operador. **No** se filtran datos financieros, ni PII de admin/staff (RLS los
oculta: el atacante vio 1 de 3 usuarios), ni hay escalada de privilegios ni escritura
(INSERT en `users` → 403; funciones de dinero → 403 por el guard `is_public_request`;
escribir tours/precios → bloqueado por RLS). El alcance es exclusivamente **exposición de PII
de personal interno (guías)** a usuarios anónimos.

La auditoría también dejó un hallazgo **BAJO/INFO** de robustez (L-1, §5) que se aprovecha
para cerrar en el mismo PR por ser de bajo riesgo y misma área (hardening).

## 2. Objetivos

- **M-1(A)**: deshabilitar el auto-registro de Supabase Auth para que ningún principal pueda
  obtener una sesión `authenticated` por fuera del flujo invite-only del operador.
- **M-1(B)**: restringir la lectura de filas de guías por RLS a las sesiones del panel
  (admin/staff), como defensa en profundidad independiente del estado de (A).
- **L-1**: agregar timeout al `fetch` de creación del payment intent en el checkout, por
  consistencia con los clientes del worker.
- No alterar ningún camino legítimo: alta de usuarios por `inviteUserByEmail`, recuperación
  de contraseña (recovery), panel de salidas (admin/staff leyendo guías), check-in, asignación.

## 3. Fuera de alcance

- No se construye ninguna UI de registro público (la app sigue siendo invite-only).
- No se modifica la capacidad de **staff** de ver a **admin/otros staff** (sigue oculta por
  B-4): este spec solo restringe la visibilidad de **guías**, no la amplía.
- No se tocan los **riesgos residuales conocidos** re-confirmados (§9), que NO son nuevos:
  secreto estático del webhook OnvoPay, CSP `unsafe-inline`, IP del checkout spoofeable según
  config de Vercel, DoS dirigido por límite de email, staff edita su propio email/phone/active,
  magic links reusables (B-5). Se documentan, no se corrigen acá.
- No se migra la autorización del panel a un modelo RBAC más rico ni se cambian los claims del
  JWT.
- No se aborda el endurecimiento de la CSP a nonces (M-2 diferido del 0016).

## 4. Historias de usuario

> Como atacante anónimo, intento auto-registrarme con `POST /auth/v1/signup` para obtener una
> sesión `authenticated` y leer datos internos, pero el endpoint de signup me rechaza.

Criterios de aceptación:

- [ ] `POST /auth/v1/signup` (endpoint público de GoTrue) responde con error (signup
      deshabilitado) y no crea una cuenta ni devuelve sesión.
- [ ] El alta de admin/staff por `inviteUserByEmail` sigue funcionando.
- [ ] El flujo de recuperación de contraseña (forgot-password / recovery) sigue funcionando.

> Como principal `authenticated` sin rol de panel (admin/staff), intento leer la PII de los
> guías vía PostgREST, pero RLS devuelve vacío.

Criterios de aceptación:

- [ ] Una sesión `authenticated` cuyo `user_role` no es `admin` ni `staff` no obtiene ninguna
      fila de `users` con `role='guide'` (resultado vacío, sin error).
- [ ] admin sigue viendo todas las filas; cada usuario sigue viendo su propia fila
      (`id = auth.uid()`); admin/staff siguen viendo las filas de guías (panel de salidas).
- [ ] La carga de `/dashboard/departures` para staff sigue listando los guías sin cambios.

> Como operador, quiero que un cuelgue de OnvoPay durante el checkout no deje la request
> colgada indefinidamente.

Criterios de aceptación:

- [ ] El `fetch` de creación de payment intent incluye `signal: AbortSignal.timeout(...)`, de
      modo que una conexión colgada aborta en vez de quedar pendiente indefinidamente. (El
      camino de error resultante ya está cubierto por el `catch` de `initCheckout`, que libera
      el hold; no se simula un timeout real — ver §10.)

## 5. Diseño técnico

**M-1(A) — deshabilitar signup.** En `supabase/config.toml`, poner en `false` **ambos**
toggles de signup (hoy en `true`):

- `[auth].enable_signup` (línea ~172) → `false`
- `[auth.email].enable_signup` (línea ~217) → `false`

`[auth.sms].enable_signup` (línea ~256) ya está en `false` y no se toca. No tocar otros
bloques de `[auth]`.

`enable_signup=false` bloquea únicamente el endpoint público `POST /auth/v1/signup` de GoTrue.
**No afecta** a `auth.admin.inviteUserByEmail` (admin API, la usa `createInternalUser` /
`resendInvite`) ni al flujo de recovery (`resetPasswordForEmail`), que son las dos únicas vías
de alta/credenciales que la app usa. El seed inserta usuarios por SQL/admin, también ajeno al
endpoint público.

`config.toml` gobierna el entorno **local** (y sirve como documentación/IaC del estado
deseado). En producción (Supabase hosted) el signup se controla en el Dashboard
(Authentication → Sign Ups / "Allow new users to sign up") salvo que se use `supabase config
push`. Por eso (A) se complementa con un ítem explícito de cutover en
`pre-production-checklist` (§11): **verificar que el proyecto de prod tiene signup
deshabilitado**. El control de datos (B) es la red que protege la PII aunque (A) quede mal
configurado en algún entorno.

**M-1(B) — restringir lectura de guías a panel.** Migración nueva
`20260612000032_restrict_guide_pii_to_panel.sql`. Reemplaza la política
`users_select_authenticated` (creada en `20260611000026`, B-4):

```sql
DROP POLICY IF EXISTS "users_select_authenticated" ON public.users;

CREATE POLICY "users_select_authenticated" ON public.users
  FOR SELECT TO authenticated
  USING (
    (select auth.jwt() ->> 'user_role') = 'admin'
    OR id = (select auth.uid())
    OR (
      role = 'guide'
      AND (select auth.jwt() ->> 'user_role') IN ('admin', 'staff')
    )
  );
```

Diferencia con B-4: el término `OR role = 'guide'` (sin condición sobre el rol del lector) pasa
a `OR (role = 'guide' AND user_role ∈ {admin, staff})`. Conserva exactamente los tres accesos
legítimos (admin ve todo; cada uno ve su fila; admin/staff ven guías para el panel) y elimina
el único acceso ilegítimo (un `authenticated` sin rol de panel — incluido uno auto-registrado,
o un eventual guía con login — leyendo PII de guías). Patrón InitPlan `(select auth.jwt() …)`
como el resto de las políticas. Forward-only; revertir = recrear la política con el `OR
role='guide'` amplio.

Ninguna ruta legítima lee `users` como `authenticated` sin rol de panel: el panel de salidas
(`web/lib/guides/repository.ts`) lo hace con la sesión de admin/staff; la vista pública del
guía (`getGuideUpcomingTours`) usa `service_role` (bypassa RLS) tras validar el token, así que
no depende de esta política.

**L-1 — timeout del checkout.** En `web/lib/payments/adapters/onvopay.ts`, el `fetch` de
`createPaymentSession` no usa `AbortSignal.timeout`, a diferencia de los clientes del worker
(refunds/reconciliación, 15 s). Una conexión colgada de OnvoPay puede atar la función
serverless del checkout hasta el timeout de plataforma. Fix: agregar
`const HTTP_TIMEOUT_MS = 15_000;` (constante **local del módulo**) y
`signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)` al `fetch`. El error resultante ya está cubierto
por el `catch` de `initCheckout`, que libera el hold y devuelve error genérico.

**Decisión de diseño (timeout local, no en `shared/`)**: la constante se duplica local en el
adapter de web, espejo de cómo el worker la tiene local en `worker/src/refunds/onvopay.ts`
(línea 9) y `reconciliation/onvopay.ts`. Razón: son adapters de OnvoPay independientes por capa
(web vs worker), el worker no resuelve `@shared` en runtime, y centralizar un único timeout HTTP
de 15 s para dos adapters que ya viven separados no aporta. Es un valor con nombre (`HTTP_TIMEOUT_MS`),
no un número mágico suelto, así que cumple la regla de lint. No se mueve a `shared/constants/`.

### Diagrama de capas

No aplica (cambios puntuales en config, una política RLS y un helper de fetch existente).

## 6. Modelo de datos

- **Tabla**: `public.users`
- **Acción**: alter (solo política RLS; sin cambios de columnas/índices/constraints)
- **Política afectada**: `users_select_authenticated` (DROP + CREATE con el término de guía
  restringido a admin/staff).
- **Migración**: `supabase/migrations/20260612000032_restrict_guide_pii_to_panel.sql`.

Sin cambios de columnas. `config.toml` y `onvopay.ts` no tocan el schema.

## 7. Estados y transiciones

No aplica. Ningún cambio introduce o modifica máquinas de estado.

## 8. Casos borde y errores

- **Alta de usuario con signup deshabilitado**: `inviteUserByEmail` (admin API) no pasa por el
  endpoint público → no afectado. Confirmado por el plan de tests (§10).
- **Recovery con signup deshabilitado**: `resetPasswordForEmail` usa el flujo recovery, no
  signup → no afectado.
- **Sesión `authenticated` sin `user_role`** (auto-registrado donde signup siga habilitado, o
  un principal sin fila en `public.users`): el término de admin es falso, `id=auth.uid()` no
  matchea ninguna fila de guía, y el término de guía exige `user_role ∈ {admin,staff}` → no ve
  guías. Resultado vacío, sin error (RLS filter policy).
- **Staff leyendo el panel de salidas**: `user_role='staff'` → el término de guía aplica → ve
  guías. Sin regresión.
- **Guía con login propio (no existe hoy)**: vería solo su propia fila (`id=auth.uid()`), no la
  de otros guías. Mejora respecto del estado actual.
- **L-1 / timeout**: si OnvoPay no responde en 15 s, `AbortSignal.timeout` aborta el `fetch`,
  `initCheckout` cae al `catch` (líneas 78-81), libera el hold y la Server Action devuelve
  `error-generic`. El cliente reintenta manualmente. La fila `payments` **no** se inserta (su
  INSERT está después del `createPaymentSession`). La fila `bookings`, en cambio, se inserta
  **antes** del `createPaymentSession` (líneas 45-59) y el `catch` solo libera el hold — queda
  una reserva huérfana en `pending_payment` **sin** fila `payments`. Esto **no es nuevo**: ya
  ocurre con cualquier fallo de `createPaymentSession` (el timeout no lo introduce). La recoge
  el job de reconciliación del worker (`reconcile-pending-payments` → `cancel_stale_pending_booking`,
  migración `…023`), que cancela las reservas `pending_payment` vencidas **sin** pago tras 2 h.
  Limpiar la `bookings` huérfana en el `catch` queda **fuera de alcance** de este spec (deuda
  preexistente, no la introduce L-1).

## 9. Impacto en otras áreas

- **Cutover a producción**: nuevo ítem bloqueante en `pre-production-checklist` — verificar
  signup deshabilitado en el proyecto Supabase de prod. La migración `…032` se suma al lote de
  migraciones de seguridad a desplegar (`…026/028/029/030/031/032`). (La `…027`, `rate_limits`,
  es del 0017 y es capa de app, no de este lote de RLS/privilegios; se omite a propósito.) L-1 y
  config.toml son capa de app/local.
- **Panel admin**: sin cambios de UI; el panel de salidas sigue funcionando (lee guías con
  sesión de panel).
- **Emails / worker / reportes**: sin impacto.
- **i18n**: sin textos nuevos.
- **Riesgos residuales conocidos re-confirmados (NO nuevos, fuera de alcance)**: webhook con
  secreto estático; CSP `unsafe-inline`; IP del checkout spoofeable según XFF de Vercel; DoS
  dirigido por límite de email; staff edita su propio email/phone/active (sin escalada, rol
  pineado por RLS); magic links reusables (B-5).
- **Memoria**: al mergear, actualizar `project-state` (4ta auditoría, 1 MEDIA + 1 BAJA
  cerradas) y `pre-production-checklist` (ítem de signup). El gotcha "auth invite-only ≠ signup
  deshabilitado" es candidato a entrada de aprendizaje vía memory-curator.

## 10. Plan de tests

**Precondición transversal (importante):** los tests de integración de este proyecto corren
**solo localmente** con `supabase start` (el CI — `.github/workflows/ci.yml` — corre únicamente
lint, typecheck y los **unit** tests; no levanta Supabase ni corre la suite de integración). Por
eso los tests de M-1(A)/(B) abajo son la red de regresión **local**, consistente con el test
existente `users-rls.test.ts` (B-4), que tampoco corre en CI. Además: **`config.toml` solo se
recarga con `supabase stop && start` (o el `start` inicial), NO con `db reset`** — antes de
correr el test de M-1(A) hay que reiniciar el stack para que GoTrue tome `enable_signup=false`.

- **M-1(A) — integración** (`web/tests/integration/`): un test que hace `POST` al endpoint
  `/auth/v1/signup` del GoTrue local y espera **rechazo** (status de error, sin sesión creada).
  _Precondición_: Supabase reiniciado con el `config.toml` nuevo (ver arriba). Complementario:
  que `auth.admin.inviteUserByEmail` sigue creando la cuenta ya está cubierto por los tests de
  alta del 0010 (se referencia, no se duplica). Si en una corrida el stack no se reinició tras
  cambiar la config, este test es el que lo delata (falla con signup aún habilitado), así que su
  valor justifica la fragilidad.
- **M-1(B) — integración** (`web/tests/integration/users-rls.test.ts`, extendiendo la suite de
  B-4): crear un usuario auth **sin** fila en `public.users` (vía `auth.admin.createUser`),
  iniciar sesión con él y verificar que `from('users').select().eq('role','guide')` devuelve
  **vacío**. _Precondición / mecanismo_: el que ese usuario **no** tenga claim `user_role`
  depende del `custom_access_token_hook` (migración `20260523000007`): hace
  `SELECT role FROM public.users WHERE id = user_id` y, sin fila, no inyecta el claim. El hook
  debe estar **registrado/activo** en el entorno (lo está: `config.toml`
  `[auth.hook.custom_access_token] enabled = true`); si no lo estuviera, el test daría un
  resultado engañoso. Mantener los casos de B-4 (staff no ve PII de admin/otros staff; admin ve
  todo) para no-regresión y **agregar** el caso que esta política debe preservar: staff **sí**
  ve filas de guías.
- **L-1 — unit** (`web/lib/payments/adapters/`): el cambio es aditivo (un `signal`); los tests
  existentes con `msw` deben seguir verdes. Se considera suficiente; no se simula un timeout real
  (bajo valor). El criterio de aceptación se limita a "el `fetch` incluye `AbortSignal.timeout`".
- **Regresión global** (local): `supabase stop && start` (recarga config) + `supabase db reset`
  (cadena completa, ahora 32 migraciones) + las 4 suites (web unit/integ, worker unit/integ) +
  lint + typecheck en verde. CI correrá unit + lint + typecheck. Reportar conteos reales en el
  changelog.
- **Re-pentest manual** (documentado en el PR): repetir el PoC de la auditoría — (a) `POST
/auth/v1/signup` falla en local; (b) aun forzando una sesión `authenticated` sin rol (vía
  `auth.admin.createUser` + signin), `GET /rest/v1/users?role=eq.guide` devuelve `[]`.

## 11. Plan de rollout

- Forward-only. Merge a `dev` vía PR (lo aprueba y mergea el usuario).
- La migración `…032` se aplica con el siguiente `db reset`/`migration up`; en prod, parte del
  lote de cutover junto con `…026/028/029/030/031`.
- `config.toml` requiere `supabase stop && start` (o `db reset`) en local para que GoTrue tome
  el `enable_signup=false`.
- **Cutover (Dashboard de prod)**: deshabilitar signup en el proyecto Supabase de producción.
  Se agrega como ítem a `pre-production-checklist`.
- Reversible: revertir el commit (config.toml + onvopay.ts) y re-crear la política amplia (B).
  Kill nada en datos.

## 12. Métricas de éxito

- `POST /auth/v1/signup` en prod → rechazado (signup off) tras el cutover.
- Una sesión `authenticated` sin rol de panel → `GET /rest/v1/users?role=eq.guide` devuelve
  `[]` (verificable por pentest post-deploy).
- Sin regresión funcional: panel de salidas lista guías; alta por invitación y recovery
  funcionan; checkout opera normal.
- Suites verdes (32 migraciones) y `audit_public_executable_functions()` / `users` sin
  exposición de PII de guías a roles no-panel.

## 13. Preguntas abiertas

Ambas resueltas por el usuario en la aprobación (2026-06-12):

- [x] **¿Auditoría de regresión no enumerativa para PII?** **RESUELTO: no se incluye.** El test
      de integración del caso "authenticated sin rol no ve guías" alcanza para una sola tabla.
      (Queda como mejora futura aditiva si la política de `users` se complejiza.)
- [x] **¿`config.toml` fuente de verdad para prod o solo el Dashboard?** **RESUELTO: el Dashboard
      es autoritativo en prod**; `config.toml` es IaC/local. El toggle de signup de prod se
      trackea como ítem de cutover en `pre-production-checklist` (M-1(A) queda como acción manual
      de cutover; la red de seguridad versionada y testeable es M-1(B)).
