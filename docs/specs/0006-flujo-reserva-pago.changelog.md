# Changelog — 0006 Flujo de reserva con pago (OnvoPay)

Spec: [0006-flujo-reserva-pago.md](./0006-flujo-reserva-pago.md)
Rama: feat/0006-flujo-reserva-pago

## 2026-05-29 — Mergeado a feat/0005, PR #9 cerrado

**Hecho**:

- Corregida URL del SDK de OnvoPay: `onvo-pay-widget.vercel.app/sdk.js` ya no existe; la URL correcta según docs.onvopay.com es `sdk.onvopay.com/sdk.js`.
- Corregido error "Request listener already exists for zoid_allow_delegate_onvo_payments_widget": el `useEffect` ahora reutiliza `window.onvo` si ya existe en lugar de recargar el script.
- Validado end-to-end con ngrok: reserva creada, pago completado con tarjeta de prueba `4242...`, webhook recibido, `bookings.status = 'confirmed'` en DB.
- PR #9 mergeado a `feat/0005-motor-disponibilidad-holds`.

**Por qué / decisiones**:

- El SDK de OnvoPay registra listeners globales (`zoid`) que persisten aunque el script se remueva del DOM. Recargar el script causa colisión de listeners. La solución es verificar `window.onvo` antes de insertar el script.
- Los errores de consola (`h.online-metrix.net`, Feature Policy) son no bloqueantes: ThreatMetrix falla en localhost (sin dominio real), OnvoPay lo ignora explícitamente. Desaparecen en producción.

**Pendiente**:

- Nada — feature implementada y mergeada. ✓

## 2026-05-27 — Implementación completa, lista para PR

**Hecho**:

- Migración SQL `20260527000012_create_bookings.sql`: tablas `bookings`, `payments`,
  `processed_webhook_events` y función `confirm_booking` (SECURITY DEFINER, SELECT FOR UPDATE).
- `web/types/database.ts` actualizado con todos los tipos nuevos.
- `PaymentProvider` interface + adaptador OnvoPay (`createOnvopayAdapter`):
  - `createPaymentSession`: POST a la API de OnvoPay con el bookingId en metadata.
  - `verifyWebhook`: HMAC SHA-256 con `timingSafeEqual`.
- `web/lib/booking/create.ts` — orquestador: hold → booking → payment session → payment record.
  Rollback de hold si falla cualquier paso intermedio.
- `web/lib/booking/checkout-action.ts` — server action que lee formData, llama `initCheckout`
  y redirige a OnvoPay.
- Página `/tours/[id]/checkout` — server component con resumen del tour/instancia.
- `CheckoutForm` (client component) — selector de cantidades, total en tiempo real,
  nombre/email, error display, submit deshabilitado si total = 0.
- Página `/checkout/success` — muestra id corto, nombre del tour, fecha, cliente.
- Página `/checkout/cancel` — libera hold activo del booking, ofrece reintentar o volver.
- Webhook handler `POST /api/webhooks/onvopay` — verifica firma, idempotencia con
  `processed_webhook_events` (ON CONFLICT = ya procesado → 200 sin reprocesar),
  busca ticket counts en la DB para llamar `confirm_booking` RPC.
- `AvailabilityCalendar` refactorizado: cada fila ahora incluye un link "Reservar" que
  apunta a `/tours/[slug]/checkout?instance=[id]`.
- i18n: namespace `checkout` completo en ES y EN.
- Tests unitarios: `calculateTotalCents` (6 casos) y `verifyWebhook` (5 casos).
- Typecheck: pasa sin errores en web y worker.

**Por qué / decisiones**:

- El webhook handler busca los ticket counts en la DB (no en el metadata de OnvoPay) para
  no ampliar la superficie de metadata enviada a un proveedor externo, y porque los counts
  están en `bookings` de todas formas.
- La cancelación libera el hold directamente desde el servidor (server component de la
  página cancel) sin un endpoint separado. Sencillo y adecuado para el MVP.
- `AvailabilityCalendar` usa `detail-book-cta` (clave ya existente en i18n) en lugar de
  agregar `detail-book`, para evitar claves duplicadas.
- Branching: `feat/0006` fue creada desde `feat/0005` (no desde el branch base) porque
  spec 0005 aún no fue mergeado, y 0006 depende de `tour_holds`.

**Pendiente**:

- Nada — feature lista para PR.

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
