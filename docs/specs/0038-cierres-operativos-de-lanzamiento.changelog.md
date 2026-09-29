# Changelog — 0038 Cierres operativos de lanzamiento

## 2026-09-29 — Implementación completa

**Hecho**:

- **Reenviar el acceso** (`lib/users/manage.ts`): busca la cuenta con `auth.admin.getUserById`. Sin cuenta devuelve `user_mgmt_account_missing`. Sin confirmar reenvía la invitación; confirmada manda el correo para fijar la contraseña (`resetPasswordForEmail` con el cliente de servicio) y el panel lo dice. `over_email_send_rate_limit` pasa a `user_mgmt_invite_rate_limited`. Los errores de Auth se registran con su código (`lib/users/auth-errors.ts`, también en `create.ts`). Reactivar una fila sin cuenta se bloquea antes de escribir.
- **Plantillas**: `supabase/templates/recovery.html` nueva y `invite.html` con el diseño de producción, ambas con enlace a `/auth/confirm?token_hash=…` y caída a `es` sin locale; `[auth.email.template.recovery]` en `config.toml`.
- **Migración 051**: trigger `on_auth_user_deleted` sobre `auth.users` (borra la fila o la deja inactiva con el correo `<id>@cuenta-borrada.invalid`) y `anonymize_booking_pii_by_email` con `retained_count` (DROP + CREATE, `REVOKE` y `GRANT` explícitos). `web/types/database.ts` actualizado a mano.
- **Bandeja "Reembolsos por resolver"** en Salidas (`lib/operations/refund-tray.ts`, `RefundTray.tsx`): el reembolso más nuevo por reserva, si está `failed`, `awaiting_transfer`, o en cola o procesando sin cambios hace más de `STUCK_REFUND_HOURS` (24).
- **Sentry**: `app/global-error.tsx` bilingüe que reporta el error; `instrumentation-client.ts` reemplaza a `sentry.client.config.ts`; `scrubEvent` (`lib/observability/sentry-scrub.ts`) quita los tokens de `/booking/`, `/guide/`, `token_hash` y `code` de la URL, los breadcrumbs y la transacción, en el navegador y en el servidor.
- **Privacidad**: después de borrar, la pantalla dice cuántas reservas quedaron retenidas.
- **Worker**: job diario `cleanup-tour-images` con la selección pura en `tour-image-cleanup-plan.ts`: 7 días de gracia, frenos sin referencias (más de 5) y con más de 50 candidatas, lista el bucket antes de leer los tours.

**Decisiones**:

- La reserva retenida usa la clave `erase-retained`; el caso con historial del trigger se prueba con `audit_logs` (no con `business_settings`, que es una sola fila compartida por otros tests).
- Un envío frenado usa el mismo mensaje para el intervalo por persona y el límite por hora del SMTP: los dos llegan con `over_email_send_rate_limit`.

**Tests**:

- Unit: `auth-errors`, `refund-tray` (5), `sentry-scrub` (4), `tour-image-cleanup-plan` (5).
- Integración: `auth-user-deleted` (3, borrando con GoTrue), `password-link` (el enlace con `token_hash` se verifica pedido con PKCE desde el navegador y con el cliente de servicio; leído desde Mailpit), `retained_count` en `retention-anonymization` y `deferred-booking-guards`.
- `cleanup-tour-images` corrido contra el Storage local.

## 2026-09-29 — Revisiones (db-schema-guardian y code-reviewer)

**Hecho**:

- Migración 051: `phone = NULL` en la fila inactiva, `COMMENT` en la función y el trigger, supuestos escritos (borrado suave de GoTrue, FK en cascada de guías). Verificado en producción que `postgres` tiene `TRIGGER` sobre `auth.users`.
- Sentry (bloqueante de la revisión): `scrubEvent` quita cookies, `authorization` y `next-router-state-tree`, limpia `Referer` y `next-url`, y recorre los spans y el contexto de la traza. En el servidor, `requestDataIntegration` sin cookies ni cuerpo. `SENTRY_TRACES_SAMPLE_RATE` compartida.
- `resendInvite` pasa a `lib/users/resend-invite.ts` y no envía nada a un usuario desactivado; tests unitarios de sus ramas y de reactivar sin cuenta.
- Worker: `coverImageUrls` compara con el total (`count: 'exact'`) y no borra nada si la lectura vino cortada; tests de paginación y de fallas de lectura con un cliente falso.
- Texto de retenidas con el verbo dentro del plural.

**Pendiente**:

- Tests de integración que no se sumaron: la bandeja leída con la sesión de staff (RLS ya cubierta por `refunds_select_admin_staff`), el GET real a `/auth/confirm` con la cookie (necesita el servidor de Next) y el caso `business_settings.updated_by` del trigger (fila única compartida con otros tests).

**Pendiente (implementación)**:

- Rollout en producción (spec §11): plantillas ya pegadas por el usuario el 2026-09-28; respaldo y migración 051 antes de promover.
- Prueba manual: forzar un error de render en el preview y verlo en Sentry sin tokens.
