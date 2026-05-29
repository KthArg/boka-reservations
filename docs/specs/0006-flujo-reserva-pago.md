# 0006 — Flujo de reserva con pago (OnvoPay)

- **Estado**: approved
- **Autor**: KthArg
- **Creado**: 2026-05-27
- **Última actualización**: 2026-05-27
- **Rama**: feat/0006-flujo-reserva-pago
- **PR**: —

## 1. Contexto y motivación

El portal muestra tours y fechas disponibles (spec 0004) y el motor de holds garantiza no-overbooking bajo concurrencia (spec 0005). Falta el paso final del funnel: que el turista pueda seleccionar una fecha, ingresar sus datos, pagar con OnvoPay y recibir una confirmación.

Este spec cierra el loop de ventas del MVP. Sin él, el producto no genera ingresos.

## 2. Objetivos

- Permitir que un turista anónimo complete una reserva pagada desde el portal público.
- Crear un hold temporal al iniciar el checkout para reservar los cupos durante el pago.
- Integrar OnvoPay como pasarela de pago mediante redirect a su hosted checkout.
- Confirmar la reserva de forma idempotente al recibir el webhook de OnvoPay.
- Mostrar al turista una página de confirmación con los detalles de su reserva.

## 3. Fuera de alcance

- Email de confirmación post-reserva (spec futuro).
- Cancelaciones y reembolsos (spec futuro).
- Panel admin para ver listado de reservas (spec futuro).
- Múltiples pasarelas de pago simultáneas (arquitectura lista; solo OnvoPay en MVP).
- Login / cuenta del turista (reservas anónimas por email).
- Selección de guía (spec futuro).

## 4. Historias de usuario

> Como turista, quiero seleccionar una fecha disponible, elegir cuántos tickets compro, pagar con tarjeta y recibir confirmación de mi reserva, sin necesidad de crear una cuenta.

Criterios de aceptación:

- [ ] Al hacer clic en "Reservar" sobre una fecha, el turista llega a una página de checkout con los detalles del tour y la fecha seleccionada.
- [ ] El formulario de checkout pide: nombre completo, email, cantidad de tickets por tipo.
- [ ] Al enviar el formulario se crea un hold y se redirige al turista a OnvoPay.
- [ ] Si el hold falla por falta de cupos, se muestra error antes de redirigir.
- [ ] Tras el pago exitoso en OnvoPay, el turista ve una página de confirmación con número de reserva.
- [ ] Si el turista cancela en OnvoPay o el pago falla, regresa a la página del tour con un mensaje.
- [ ] El webhook de OnvoPay confirma la reserva de forma idempotente (doble entrega no duplica la reserva).
- [ ] Al confirmar, `capacity_reserved` de la instancia se incrementa y el hold pasa a `converted`.

## 5. Diseño técnico

### Flujo completo

```
Turista → /tours/[slug]
  → clic "Reservar" en fecha  → /tours/[slug]/checkout?instance=[id]
  → rellena form + envía      → Server Action: initCheckout()
      1. createHold()
      2. INSERT booking (pending_payment)
      3. INSERT payment (pending)
      4. onvopay.createPaymentSession() → paymentUrl
      5. redirect(paymentUrl)
  → OnvoPay hosted checkout
  → pago exitoso              → OnvoPay redirect → /checkout/success?booking=[id]
  → webhook POST /api/webhooks/onvopay
      1. Verificar firma
      2. Idempotencia: INSERT processed_webhook_events ON CONFLICT DO NOTHING
      3. UPDATE booking → confirmed
      4. UPDATE payment → succeeded
      5. UPDATE tour_instances.capacity_reserved += tickets
      6. UPDATE tour_holds → converted
  → Turista ve página de éxito con detalles
```

### Páginas nuevas

- `/[locale]/tours/[slug]/checkout` — formulario de checkout (server component + client form).
- `/[locale]/checkout/success` — confirmación post-pago (lee booking por query param).
- `/[locale]/checkout/cancel` — regreso por cancelación en OnvoPay; muestra mensaje y link al tour.

### OnvoPay — adapter

Módulo `web/lib/payments/adapters/onvopay.ts` que implementa la interfaz `PaymentProvider`:

```typescript
interface PaymentProvider {
  createPaymentSession(params: CreatePaymentParams): Promise<PaymentSession>;
  verifyWebhook(rawBody: string, signature: string): WebhookPayload | null;
}
```

`createPaymentSession` hace un `POST` a la API de OnvoPay con el monto, moneda, descripción y URLs de retorno. La respuesta incluye la URL a la que redirigir al turista y el ID externo del pago.

`verifyWebhook` valida la firma HMAC del webhook usando `ONVOPAY_WEBHOOK_SECRET` y retorna el payload parseado, o `null` si la firma no coincide.

### Módulo de creación de reserva

`web/lib/booking/create.ts` orquesta la transacción lógica:

1. Llama `createHold` (spec 0005).
2. Inserta `bookings` con `status = 'pending_payment'`.
3. Inserta `booking_tickets` con la cantidad por tipo.
4. Inserta `payments` con `status = 'pending'`.
5. Llama `onvopay.createPaymentSession()`.
6. Retorna la `paymentUrl`.

Ante cualquier error después del hold, lo libera con `releaseHold`.

### Webhook handler

`web/app/api/webhooks/onvopay/route.ts` — POST handler:

1. Lee el raw body y la firma del header.
2. Verifica la firma; si falla → 400.
3. `INSERT INTO processed_webhook_events (id) VALUES ($eventId) ON CONFLICT DO NOTHING` — si no hubo inserción → 200 sin procesar (idempotencia).
4. Dentro de una transacción Supabase (RPC): actualiza booking, payment, capacity_reserved, hold.

### AvailabilityCalendar actualizado

El componente pasa de mostrar strings a mostrar filas con `instanceId` y un link `<Link>` a la página de checkout. Necesita recibir las instancias con `id` y no solo las fechas formateadas.

## 6. Modelo de datos

### Tabla nueva: `bookings`

| Columna              | Tipo                          | Notas                                                           |
| -------------------- | ----------------------------- | --------------------------------------------------------------- |
| `id`                 | `uuid` PK                     | `gen_random_uuid()`                                             |
| `tour_instance_id`   | `uuid` FK                     | `tour_instances.id`                                             |
| `hold_id`            | `uuid` FK nullable            | `tour_holds.id`                                                 |
| `customer_name`      | `text` NOT NULL               |                                                                 |
| `customer_email`     | `text` NOT NULL               |                                                                 |
| `tickets_adult`      | `integer` NOT NULL DEFAULT 0  |                                                                 |
| `tickets_child`      | `integer` NOT NULL DEFAULT 0  |                                                                 |
| `tickets_student`    | `integer` NOT NULL DEFAULT 0  |                                                                 |
| `total_amount_cents` | `integer` NOT NULL            |                                                                 |
| `currency`           | `text` NOT NULL DEFAULT 'USD' |                                                                 |
| `status`             | `text` NOT NULL               | CHECK IN ('pending_payment','confirmed','cancelled','refunded') |
| `created_at`         | `timestamptz` NOT NULL        |                                                                 |
| `updated_at`         | `timestamptz` NOT NULL        |                                                                 |

### Tabla nueva: `payments`

| Columna               | Tipo                   | Notas                                                |
| --------------------- | ---------------------- | ---------------------------------------------------- |
| `id`                  | `uuid` PK              |                                                      |
| `booking_id`          | `uuid` FK              | `bookings.id`                                        |
| `external_provider`   | `text` NOT NULL        | `'onvopay'`                                          |
| `external_payment_id` | `text` NOT NULL        | ID de OnvoPay                                        |
| `amount_cents`        | `integer` NOT NULL     |                                                      |
| `currency`            | `text` NOT NULL        |                                                      |
| `status`              | `text` NOT NULL        | CHECK IN ('pending','succeeded','failed','refunded') |
| `created_at`          | `timestamptz` NOT NULL |                                                      |
| `updated_at`          | `timestamptz` NOT NULL |                                                      |

### Tabla nueva: `processed_webhook_events`

| Columna        | Tipo                   | Notas               |
| -------------- | ---------------------- | ------------------- |
| `id`           | `text` PK              | event_id de OnvoPay |
| `processed_at` | `timestamptz` NOT NULL | `NOW()`             |

Migración: `20260527000012_create_bookings.sql`

## 7. Estados y transiciones

```
booking.status:
  pending_payment → confirmed (webhook succeeded)
  pending_payment → cancelled (timeout / cancelación manual futura)

payment.status:
  pending → succeeded (webhook)
  pending → failed (webhook)
```

## 8. Casos borde y errores

- **Hold expira durante el checkout**: `initCheckout` verifica que el hold esté activo antes de redirigir; si expiró, intenta crear uno nuevo.
- **OnvoPay no responde**: `initCheckout` libera el hold y retorna error al usuario antes de redirigir.
- **Webhook duplicado**: `ON CONFLICT DO NOTHING` en `processed_webhook_events` garantiza idempotencia.
- **Webhook con firma inválida**: retorna 400 sin procesar.
- **Turista regresa al checkout después de pagar**: la página de checkout detecta que el booking ya está `confirmed` y redirige a `/checkout/success`.
- **Pago fallido en OnvoPay**: OnvoPay redirige a `cancelUrl`; la página de cancel muestra error y libera el hold.

## 9. Impacto en otras áreas

- **AvailabilityCalendar**: refactor para incluir `instanceId` y botón "Reservar" por fila.
- **Tour detail page**: sin cambios estructurales; el calendario actualizado provee los links.
- **Worker**: sin cambios (el hold lo convierte el webhook, no el worker).
- **i18n**: claves nuevas en `es.json` y `en.json` para checkout, success y cancel.
- **`web/lib/env.ts`**: `ONVOPAY_SECRET_KEY` y `ONVOPAY_WEBHOOK_SECRET` ya están; se hacen requeridos (actualmente opcionales en worker, aquí son requeridos en web).

## 10. Plan de tests

- **Unit**: `calculateTotal(pricing, quantities)` — función pura que calcula el total en centavos.
- **Unit**: `verifyWebhook` con firma válida e inválida.
- **Integración**: flujo completo de `initCheckout` con OnvoPay mockeado (MSW).
- **Integración**: webhook handler — idempotencia, booking confirmado, capacity_reserved incrementado.

## 11. Plan de rollout

- Requiere `ONVOPAY_SECRET_KEY` y `ONVOPAY_WEBHOOK_SECRET` en producción.
- La URL de webhook debe registrarse en el dashboard de OnvoPay: `https://<dominio>/api/webhooks/onvopay`.
- Sin feature flag (es funcionalidad nueva, no reemplaza nada).
- Reversible: si algo falla, el botón "Reservar" puede volverse a `under-construction` en 1 línea.

## 12. Métricas de éxito

- Al menos una reserva pagada end-to-end en el primer día de producción.
- Cero casos de doble-cobro o doble-reserva en los primeros 30 días.
- Tasa de conversión checkout → pago completado ≥ 60%.

## 13. Preguntas abiertas

Ninguna.
