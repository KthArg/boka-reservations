# 0010 — Gestión de usuarios internos

- **Estado**: approved
- **Autor**: Kenneth
- **Creado**: 2026-06-01
- **Última actualización**: 2026-06-01
- **Rama**: feat/0010-gestion-usuarios-internos (cuando aplique)
- **PR**: # (cuando aplique)

## 1. Contexto y motivación

Hoy los usuarios internos (admin, staff, guías) solo se pueden dar de alta editando el `seed.sql` o corriendo SQL crudo contra la base. No hay forma de que el cliente cree un guía nuevo cuando contrata personal, ni de desactivar a alguien que se va. Esto se detectó como gap operativo en el Checkpoint 5: la creación de usuarios internos se difirió explícitamente en el spec 0002 ("los usuarios internos los crea el admin desde el panel en una etapa posterior") y nunca se retomó.

Esta feature le da al **admin** una sección del panel para gestionar el equipo: listar, crear, editar y desactivar usuarios internos de cualquier rol, sin tocar la base a mano.

Actores:

- **Admin**: único rol que puede gestionar usuarios (las políticas RLS de 0002 ya restringen escrituras sobre `users` al claim `user_role = 'admin'`).
- **Staff / guía**: son gestionados, no gestionan.

## 2. Objetivos

- Permitir que el admin cree, edite y desactive usuarios internos (admin, staff, guía) desde el panel, sin SQL.
- Onboardear admin/staff nuevos con un email de invitación para que fijen su propia contraseña (sin que el admin maneje credenciales ajenas).
- Crear guías como usuarios sin cuenta de login (solo magic link), coherente con el spec 0009.
- Dar de baja con **desactivación** (soft delete) para preservar historial y referencias.

## 3. Fuera de alcance

- **Login de guías**: los guías NO tienen cuenta de autenticación; acceden solo por el magic link de 0009. Crear un guía no toca `auth.users`.
- **Cambio de rol después de creado**: el rol se fija al crear. Cambiarlo cruza la frontera de auth (un guía sin cuenta que pasa a staff necesitaría cuenta, y viceversa); se difiere. Si hace falta, se desactiva y se crea de nuevo.
- **Cambio de email después de creado**: editar el email de un usuario con cuenta de auth es delicado (re-verificación). Fuera de alcance; el email se fija al crear.
- **Auto-registro / signup público**: sigue sin existir. Solo el admin crea usuarios.
- **Gestión de permisos finos**: los roles siguen siendo los tres existentes (`admin`/`staff`/`guide`) con sus capacidades actuales. No se introducen permisos granulares.
- **Hard delete**: no se borran usuarios; se desactivan.
- **Auditoría en `audit_logs`**: esa tabla se crea en el spec de cancelaciones (0011); este spec no la usa.

## 4. Historias de usuario

> Como admin, quiero crear un guía nuevo desde el panel, para poder asignarlo a salidas sin pedirle a un dev que toque la base.

Criterios de aceptación:

- [ ] El admin completa nombre, email, teléfono e idioma y crea un guía. El guía aparece de inmediato en la lista y en el selector de asignación de 0009.
- [ ] Crear un guía NO crea cuenta de auth (no puede loguearse; usa magic link).
- [ ] El teléfono es obligatorio para guías (constraint `guide_requires_phone` de 0002).

> Como admin, quiero crear un admin/staff nuevo que reciba un email para fijar su contraseña, para no tener que compartir contraseñas por fuera.

Criterios de aceptación:

- [ ] Al crear un admin/staff, el sistema crea su cuenta de auth y le envía un email de invitación para fijar contraseña.
- [ ] Hasta que no la fija, no puede entrar (no hay contraseña válida).
- [ ] El admin nunca ve ni elige la contraseña del otro.

> Como admin, quiero desactivar a alguien que dejó el equipo, para que pierda acceso sin borrar su historial.

Criterios de aceptación:

- [ ] Desactivar un usuario lo marca `active = false`; deja de poder operar (login bloqueado para admin/staff; el guía desaparece del selector de asignación).
- [ ] El historial (quién hizo check-in, quién asignó) se conserva intacto.
- [ ] Un admin no puede desactivarse a sí mismo ni dejar el sistema sin ningún admin activo.
- [ ] Se puede reactivar.

## 5. Diseño técnico

### Roles y dos caminos de creación

La diferencia clave es si el usuario **inicia sesión**:

- **Guía** → solo `public.users` (fila con `role='guide'`, `id` por `gen_random_uuid()`). Sin `auth.users`. No tiene cómo loguearse; usa el magic link de 0009. La validación del token (0009) lee `public.users` por id, no necesita auth.
- **Admin / staff** → `auth.users` + `public.users` con el **mismo `id`** (para que `auth.uid()` coincida y las RLS `users_update_self` etc. funcionen, igual que el seed). Se crea la cuenta de auth con la **Supabase Admin API** (service role) sin contraseña y con email confirmado, y se dispara el **email de invitación** para que fije su contraseña.

`public.users.id` NO tiene FK a `auth.users` (ver migración 0002), así que un guía sin cuenta de auth es un estado válido.

### Email de invitación (reusa el flujo de auth existente)

El onboarding de admin/staff reutiliza el mecanismo de **Supabase Auth** ya usado por `forgot-password` (`resetPasswordForEmail`): tras crear la cuenta de auth, se envía el email de "fijá tu contraseña". Estos emails salen por el **SMTP de Supabase Auth** (Mailpit en dev, el SMTP configurado en prod), NO por la cola `notifications` del 0007.

**Decisión y tradeoff**: se acepta esta divergencia de la convención "todos los emails por la cola" porque es coherente con cómo ya funciona el reset de contraseña (mismo canal, mismo template de Supabase) y evita reimplementar el set-password con tokens propios. El email de invitación es un email de auth, no transaccional de negocio.

### Server Actions (admin-only, service role)

En `lib/users/` (nuevo módulo), todas verifican `requireRole(UserRole.Admin)` y usan el service client:

- `createUser(input)`: valida con Zod; si `role='guide'` inserta solo en `public.users`; si no, crea `auth.users` (Admin API) + `public.users` con el mismo id + envía invitación. Email único (rechaza duplicados).
- `updateUser(id, input)`: edita `full_name`, `phone`, `locale`. (Rol y email inmutables — ver fuera de alcance.)
- `deactivateUser(id)` / `reactivateUser(id)`: togglea `active`. `deactivateUser` rechaza si el target es el propio admin o si es el último admin activo.
- `resendInvite(id)` (opcional): reenvía el email de invitación a un admin/staff que aún no fijó contraseña.

La lógica de negocio (validaciones, guard del último admin) vive en `lib/users/`; las acciones validan input y delegan.

### UI del panel (rutas en inglés)

Sección nueva bajo `/dashboard/users` (ver [[url-naming]] — URLs en inglés):

- `/dashboard/users` — lista con filtros por rol y estado (activo/inactivo), badges de rol, acción desactivar/reactivar.
- `/dashboard/users/new` — formulario de alta (campos según rol; teléfono obligatorio si guía).
- `/dashboard/users/[id]/edit` — edición de campos permitidos.

Link de nav nuevo "Usuarios" (visible solo para admin). Los guards de la sección son admin-only.

### Validación (Zod, en `shared/schemas.ts`)

`UserCreateSchema`: `email` (email válido), `full_name` (1–120), `role` (enum `UserRole`), `phone` (requerido si `role='guide'`, vía refine), `locale` (`'es'|'en'`). `UserUpdateSchema`: `full_name`, `phone`, `locale`.

## 6. Modelo de datos

**Sin cambios al schema.** La tabla `users` (spec 0002, + `locale` de 0009) ya tiene todas las columnas: `id`, `email`, `role`, `full_name`, `phone`, `active`, `locale`, `created_at`, `updated_at`, con el constraint `guide_requires_phone` y las políticas RLS admin-only para insert/update/delete. No hace falta migración.

Opcional (no se implementa salvo que se decida en review): columna `created_by uuid REFERENCES users(id)` para registrar quién dio de alta. Se deja fuera para no meter migración; si se quiere trazabilidad, va con `audit_logs` en 0011.

## 7. Estados y transiciones

`users.active`: `true ⇄ false` vía deactivate/reactivate. Estado terminal no hay (siempre reversible). El login (0002, `requireAuth`) ya rechaza `active = false` con `ACCOUNT_INACTIVE`.

No se introduce otra máquina de estados.

## 8. Casos borde y errores

- **Email duplicado**: `createUser` rechaza (la columna `email` es UNIQUE; además chequear antes para dar error claro). Si la cuenta de auth se creó pero el insert en `public.users` falla, revertir la cuenta de auth (o crear primero `public.users` y auth después con rollback manual) — definir orden transaccional en implementación: crear auth primero, y si falla el `public.users`, borrar la cuenta de auth recién creada.
- **Guía sin teléfono**: rechazado por Zod y por el CHECK de DB.
- **Desactivarse a sí mismo**: rechazado (no lockout).
- **Desactivar al último admin activo**: rechazado (el sistema siempre debe tener ≥1 admin activo).
- **Crear admin/staff con email que ya existe en `auth.users`**: la Admin API falla; mapear a error claro "email ya registrado".
- **Guía desactivado con magic link vigente**: queda fuera del selector de asignación (`listGuides` ya filtra `active=true`) **y** su magic link deja de funcionar — la vista del guía verifica `active` y trata al guía desactivado como token inválido (mismo mensaje de "enlace no válido"). Esto es seguro porque el guía no tiene forma de cambiar su propio `active` (sin cuenta de auth, vista de solo lectura, RLS admin-only sobre `users`).
- **Falla de envío del email de invitación**: la cuenta queda creada pero sin invitación enviada; exponer `resendInvite` para reintentar y no dejar al usuario inaccesible.
- **Concurrencia**: dos admins creando el mismo email a la vez → el UNIQUE de `email` garantiza que solo uno gane; el otro recibe error de duplicado.

## 9. Impacto en otras áreas

- **Panel admin**: sección nueva `/dashboard/users` + link de nav (solo admin). Reusa el patrón de guards y Server Actions de 0008/0009.
- **Auth (0002)**: se usa la Admin API de Supabase (service role) para crear cuentas; el email de invitación reusa el canal de `resetPasswordForEmail`. Sin cambios a las políticas RLS (ya son admin-only).
- **Guías (0009)**: `listGuides` ya filtra `active=true`, así que desactivar saca al guía del selector sin cambios. Además, este spec **modifica `getGuideUpcomingTours`** (vista del guía) para verificar `users.active`: un guía desactivado ve "enlace no válido" aunque su token siga vigente. Es robusto porque el guía no puede alterar su propio `active` (sin login, vista de solo lectura, RLS admin-only).
- **i18n**: namespace nuevo `users` en AMBOS `es.json` Y `en.json` (lección de 0008/0009).
- **Emails/templates**: no se crea template propio; la invitación usa el email de Supabase Auth.
- **Pagos / reservas / refunds**: sin impacto.

## 10. Plan de tests

- **Unit (web)**: validación Zod (`UserCreateSchema` exige teléfono si guía; rechaza email inválido); lógica del guard "último admin activo".
- **Integración (web)**: `createUser` para guía → inserta solo en `public.users`, sin `auth.users`, aparece en `listGuides`. `createUser` para staff → crea `auth.users` + `public.users` con mismo id (verificable con service client) y dispara invitación (en dev, verificable en Mailpit). `deactivateUser` togglea `active` y bloquea desactivarse a sí mismo / al último admin. `updateUser` cambia campos permitidos. Validación admin-only (un staff es rechazado). Email duplicado rechazado.
- **Integración (web)**: guía desactivado → `getGuideUpcomingTours` (vista del guía, 0009) devuelve null aunque el token siga vigente.
- **Manual (PR)**: crear guía y asignarlo en 0009; crear staff, recibir invitación en Mailpit, fijar contraseña, loguear; desactivar y verificar bloqueo de login.

## 11. Plan de rollout

- **Sin feature flag**: sección aislada, aditiva.
- **Sin migración**: usa el schema existente.
- **Variables de entorno**: ninguna nueva (la Admin API usa el `SUPABASE_SERVICE_ROLE_KEY` ya presente; el email de invitación usa el SMTP de Supabase ya configurado).
- **Datos existentes**: los usuarios del seed siguen válidos; los guías del seed tienen cuenta de auth (de cuando se sembraron) pero eso no molesta — los guías nuevos creados por UI simplemente no la tendrán.
- **Reversibilidad**: aditiva; ante problemas se deja de usar la sección. Nada destructivo.

## 12. Métricas de éxito

- El cliente da de alta y baja usuarios sin pedir intervención de dev (0 tickets de "creame un usuario por SQL").
- Los admin/staff nuevos completan el onboarding por invitación (fijan contraseña y loguean) sin compartir credenciales.

## 13. Preguntas abiertas

Ninguna. Decisiones cerradas en la aprobación (2026-06-01):

- **`created_by`**: no se agrega por ahora (sin migración). La trazabilidad de quién dio de alta se difiere a cuando exista `audit_logs` (spec 0011).
- **Magic link del guía al desactivar**: se invalida — la vista del guía verifica `active`. Es seguro porque el guía no puede cambiar su propio `active` desde el frontend (sin login, vista de solo lectura, RLS admin-only).
