# Changelog — 0006 Flujo de reserva con pago (OnvoPay)

Spec: [0006-flujo-reserva-pago.md](./0006-flujo-reserva-pago.md)
Rama: feat/0006-flujo-reserva-pago

## 2026-05-27 — Inicio de implementación

**Hecho**:

- Spec aprobado y changelog iniciado.
- Rama `feat/0006-flujo-reserva-pago` creada desde `feat/0005-motor-disponibilidad-holds`
  para incluir la dependencia de holds.

**Pendiente**:

- Migración SQL: `bookings`, `payments`, `processed_webhook_events`.
- `web/lib/payments/adapters/onvopay.ts` + interfaz `PaymentProvider`.
- `web/lib/booking/create.ts` — orquestador del checkout.
- Checkout page + CheckoutForm + CSS.
- Páginas success y cancel.
- Webhook handler `/api/webhooks/onvopay`.
- Refactor `AvailabilityCalendar` con links de reserva.
- i18n ES/EN para checkout, success, cancel.
- Tests + typecheck + commits.
