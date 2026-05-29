# Changelog — 0007 Notificaciones por email

Spec: [0007-notificaciones-email.md](./0007-notificaciones-email.md)
Rama: feat/0007-notificaciones-email

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
