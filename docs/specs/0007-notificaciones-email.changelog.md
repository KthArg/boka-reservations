# Changelog — 0007 Notificaciones por email

Spec: [0007-notificaciones-email.md](./0007-notificaciones-email.md)
Rama: feat/0007-notificaciones-email

## 2026-05-29 — Implementación terminada, lista para PR

**Hecho**:

- Migración `20260530000013_create_notifications.sql`: tabla `notifications` con cola persistente, índice parcial `(scheduled_for) WHERE status='pending'`, RLS habilitado, `bookings.locale ('es'|'en')`, y `confirm_booking` actualizado para encolar las dos notificaciones dentro de la misma transacción con `ON CONFLICT DO NOTHING`.
- Web `checkoutAction` captura `getLocale()` de `next-intl` y lo persiste en `bookings.locale`. `web/types/database.ts` refinado a mano con los tipos nuevos (no regenerar con `supabase gen types` directo — pierde unions manuales).
- Worker:
  - `worker/src/notifications/{types,backoff,render,repository}.ts` + `adapters/{resend,mailpit,index}.ts` + `templates/{layout,format,booking-confirmation,reminder-24h}.ts`.
  - `worker/src/jobs/send-notifications.ts` con polling 60s, validación just-in-time del estado del booking, retry transient (1/5/30 min, 3 intentos) y fail permanent inmediato.
  - `worker/src/env.ts` extendido con `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` (obligatorio solo si provider=resend), `SMTP_HOST`, `SMTP_PORT`, `NOTIFICATIONS_ENABLED`.
- Tests:
  - Unit worker (6 archivos / 29 tests): backoff, templates, lógica del job con repository mockeado.
  - Integration web (3 tests): `confirm_booking` encola las dos notificaciones, idempotencia ante doble llamada, reminder en el pasado para `starts_at <24h`.
  - Integration worker (2 tests): despacho real end-to-end contra DB y Mailpit, cancel cuando el booking ya no está confirmed.
- Infra: `supabase/config.toml` habilita Mailpit `smtp_port=54325`, `.env.example` documenta las variables nuevas, `integration.setup.ts` en web y worker carga `.env.local` antes de los tests de integración.

**Por qué / decisiones**:

- **Templates y adapters en `worker/`, no en `web/`** (desvío del spec original, ahora rev. 4). El único consumidor es el job; cross-import entre paquetes no estaba configurado y agregaba complejidad sin beneficio. El spec quedó actualizado.
- **Sin React Email** (también rev. 4). El worker es Node puro; agregar React + `@react-email/render` para dos templates planos era overhead. Templates como funciones puras `(props, locale) => { subject, html, text }` con HTML inline y escape manual. Cuando se aborde el rebrand de la app (deuda anotada), pueden migrar.
- **Encolado dentro de `confirm_booking`** (no en el handler del webhook): garantiza transaccionalidad y deja el handler completamente delegando.
- **Idempotencia en dos capas**: `UNIQUE (booking_id, kind)` + `ON CONFLICT DO NOTHING` para el encolado; `provider_message_id` + idempotency-key para el envío.
- **Mailpit SMTP en `:54325`** (puerto que Supabase deja deshabilitado por default): habilitado en `config.toml`. Requiere `supabase stop && supabase start` la primera vez que se aplica el cambio.
- **Cancel just-in-time** en el job en lugar de UPDATE proactivo en el handler de cancelación: simplifica y evita race conditions.

**Pendiente**:

- Nada — feature lista para PR.

**Notas para retomar**:

- Para validar el reminder sin esperar 24h reales: `UPDATE notifications SET scheduled_for = NOW() WHERE booking_id = ... AND kind = 'reminder_24h'` y esperar al siguiente ciclo del worker (≤60s) o invocar `sendNotifications()` directo.
- La configuración de Resend (cuenta, dominio, API key, secret en Railway) queda como deuda técnica en `project-state.md` — bloquea el primer deploy a staging/prod, no la implementación.

## 2026-05-29 — Inicio de la implementación

**Hecho**:

- Spec 0007 aprobado y commiteado.
- Rama `feat/0007-notificaciones-email` creada desde `chore/etapa2-setup-tecnico`.
- Decisión confirmada con el usuario: arrancar contra Mailpit en dev; Resend queda deferido hasta que el cliente confirme dominio remitente (anotado como deuda técnica en `project-state.md` de la memoria).

**Por qué / decisiones**:

- Resend no aporta valor mientras no haya dominio verificado (solo permite enviar al owner de la cuenta). Mailpit ya corre como parte de `supabase start` y cubre el ciclo completo de dev y CI sin red ni cuota.
- Spec partido en hitos pequeños para commits atómicos: (1) migración, (2) capturar locale en booking, (3) adapters, (4) templates, (5) job worker, (6) tests, (7) env.example.

**Pendiente**:

- Migración `20260530000013_create_notifications.sql`: crear tabla `notifications`, agregar `bookings.locale`, actualizar `confirm_booking` para encolar las dos notificaciones.
