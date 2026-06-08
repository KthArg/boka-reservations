# 0014 — Validación de monto del pago antes de confirmar

- **Estado**: approved
- **Autor**: Kenneth
- **Creado**: 2026-06-08
- **Última actualización**: 2026-06-08 (spec-reviewer incorporado; campo OnvoPay confirmado; aprobado)
- **Rama**: feat/0014-validacion-monto-webhook
- **PR**: # (cuando aplique)

## 1. Contexto y motivación

Cuando OnvoPay reporta un pago exitoso, el sistema confirma la reserva **sin
comparar el monto realmente pagado contra el monto que esperábamos cobrar**. Un
evento `payment-intent.succeeded` por un monto distinto (error de la pasarela,
manipulación, pago parcial) confirmaría la reserva igual, como si todo cuadrara.
Es un agujero de flujo de dinero detectado en la auditoría del PR #27.

El pago es de **monto fijo que arma el propio sistema** en el checkout (spec 0006):
`payments.amount_cents` + `payments.currency` son la fuente de verdad de lo que se
debía cobrar. Cualquier diferencia con lo que OnvoPay dice que se pagó es una
anomalía que NO debe confirmarse automáticamente.

Afecta al **operador** (recibe dinero que no cuadra sin enterarse) e indirectamente
al **turista** (una reserva podría confirmarse por un pago incorrecto).

Hay dos caminos que confirman una reserva y **ambos** deben validar el monto:

1. el **webhook** de OnvoPay (`web/app/api/webhooks/onvopay/route.ts`), y
2. el **job de reconciliación** del spec 0013 (`worker`), que recupera reservas
   cuyo webhook se perdió consultando `GET /v1/payment-intents/:id`.

Si solo se validara en el webhook, una reserva con monto incorrecto que quedara en
`pending_payment` sería confirmada después por el reconciliador (que la ve
`succeeded` en OnvoPay), salteándose la validación. Por eso la reserva con mismatch
debe salir de `pending_payment` a un estado propio.

## 2. Objetivos

- Comparar, antes de confirmar, el monto y la moneda reportados por OnvoPay contra
  `payments.amount_cents`/`currency` esperados, en los dos caminos de confirmación.
- No confirmar una reserva cuyo pago no coincide exactamente; dejarla en un estado
  propio de revisión manual (fuera de `pending_payment`, para que el reconciliador
  no la levante ni reintente en loop).
- Registrar cada mismatch en `audit_logs` y alertarlo a Sentry para que el operador
  lo resuelva.

## 3. Fuera de alcance

- **No** se construye una acción en el panel para "resolver" un mismatch (confirmar a
  mano, reembolsar). El operador lo maneja por fuera (dashboard de OnvoPay, contacto
  con el cliente) o se cubre en un spec futuro. Esta feature solo **detecta, frena y
  hace visible** la anomalía.
- **No** se reembolsa automáticamente el pago incorrecto (decisión comercial; el
  operador decide).
- **No** se cambia el flujo de checkout ni el cálculo del monto (spec 0006).
- **No** se agrega tolerancia: la comparación es de igualdad exacta (decisión de
  revisión 2026-06-08).
- **No** se toca la idempotencia del webhook (spec/PR #27) ni la lógica de
  reconciliación del 0013 más allá de insertar la validación antes de confirmar.

## 4. Historias de usuario

> Como operador, quiero que una reserva cuyo pago no coincide con el monto esperado
> NO se confirme sola y me quede marcada para revisar, para no aceptar dinero que no
> cuadra como si fuera una venta normal.

Criterios de aceptación:

- [ ] Si el monto **y** la moneda del pago reportado por OnvoPay coinciden exactamente
      con `payments.amount_cents`/`currency`, la reserva se confirma como hoy.
- [ ] Si **monto o moneda difieren**, la reserva NO se confirma: pasa a estado
      `payment_mismatch`, se registra en `audit_logs` (`booking.payment_mismatch`,
      `actor_type='system'`, con esperado vs pagado) y se alerta a Sentry.
- [ ] La validación aplica tanto en el webhook como en el job de reconciliación (0013).
- [ ] Una reserva en `payment_mismatch` NO es levantada por el reconciliador (no está
      en `pending_payment`) ni reintentada en loop.
- [ ] La reserva en `payment_mismatch` es visible en el panel de reservas con su propia
      etiqueta/badge.
- [ ] El pago de una reserva en `payment_mismatch` NO se cuenta como ingreso en los
      reportes (su `payments.status` no es `succeeded`).

## 5. Diseño técnico

### Dónde se valida

La comparación (`paid_amount_cents === expected && paid_currency === expected`) es
trivial y vive **en cada caller** (el webhook en web, el reconciliador en worker — el
worker no resuelve `@shared` en runtime, ver memoria, así que no se comparte un helper
en runtime; son dos líneas en cada lado). La **transición de estado** sí se centraliza
en una función DB para que ambos caminos la hagan igual y de forma atómica.

### Función SQL `flag_payment_mismatch` (migración nueva)

`flag_payment_mismatch(p_booking_id uuid, p_paid_amount_cents int, p_paid_currency text, p_source text) RETURNS boolean`.
Atómica, espejo conceptual de `cancel_stale_pending_booking` (0013):

- `SELECT ... FOR UPDATE` sobre la reserva; si no está `pending_payment`, `RETURN false`
  (idempotente y seguro ante la race entre webhook y reconciliador, o doble entrega).
- Lee el pago esperado (`payments.amount_cents`/`currency` por `booking_id`) para la
  bitácora.
- `UPDATE bookings SET status = 'payment_mismatch'`.
- **No** toca `payments` (queda `pending`: el dinero está en OnvoPay pero el sistema
  NO lo reconoce como venta válida → no entra a reportes). **No** toca
  `capacity_reserved` (la reserva nunca lo incrementó, igual que en 0013).
- `INSERT INTO audit_logs` (`actor_type='system'`, **`actor_id` omitido → NULL** (acción
  del sistema, igual que `cancel_stale_pending_booking`), `action='booking.payment_mismatch'`,
  metadata `{expected_amount_cents, expected_currency, paid_amount_cents, paid_currency, source}`).
- `SECURITY DEFINER` + `SET search_path=''` + `REVOKE EXECUTE ... FROM PUBLIC`.

### Estado nuevo `payment_mismatch`

- Migración: `ALTER TABLE bookings` para reemplazar el CHECK de `status` agregando
  `'payment_mismatch'`.
- `shared/constants/enums.ts`: `BookingStatus.PaymentMismatch = 'payment_mismatch'`.
- `web/types/database.ts`: agregar el valor a la unión de `bookings.status`
  (Row/Insert/Update) y la función `flag_payment_mismatch` a `Functions` (a mano,
  estilo narrow, por el gotcha del CLI).

### Webhook (`web/app/api/webhooks/onvopay/route.ts`)

Hoy busca el `payment` por `external_payment_id` y toma `booking_id`. Se extiende ese
select a `amount_cents, currency` (único cambio de lectura). El `WebhookPayload` ya
expone `amountCents` y `currency` (los mapea `verifyWebhook` en el adaptador), así que
**no hay cambio en el adaptador**. Antes de `confirm_booking`:

- Si `payload.amountCents !== payment.amount_cents || payload.currency !== payment.currency`
  → `rpc('flag_payment_mismatch', {...})` + `Sentry.captureMessage` (warning,
  fingerprint `webhook-payment-mismatch`) + responder **200** (no es transitorio;
  reintentar no lo arregla, evita loop de retries de OnvoPay).
- Si coincide → `confirm_booking` como hoy (con `p_event_id`, ver PR #27).

### Reconciliador (worker, spec 0013)

- `worker/src/reconciliation/onvopay.ts`: `getPaymentIntent` devuelve además
  `amountCents` y `currency`, leídos de los campos **`amount`** (entero, unidad menor =
  céntimos, comparable directo con `payments.amount_cents`) y **`currency`** (código de
  3 letras) del cuerpo del `GET /v1/payment-intents/:id` (confirmado en la doc oficial
  de OnvoPay, 2026-06-08; mismos campos que usa el adaptador del webhook).
- `worker/src/reconciliation/repository.ts`: `fetchStalePendingBookings` selecciona
  también `payments(amount_cents, currency)`.
- En la rama de recuperación (`outcome = Paid`), **dentro de `recover()`** (antes de
  `confirmRecoveredBooking`): comparar el monto/moneda de OnvoPay contra el pago
  esperado. Tres casos: (a) coincide → recuperar como hoy (`confirmRecoveredBooking`
  llama `confirm_booking` con **3 args**, sin `p_event_id` — el reconciliador no es un
  webhook, ver PR #27); (b) difiere → `flag_payment_mismatch` + `Sentry.captureMessage`
  (warning, fingerprint `reconcile-payment-mismatch`); (c) **monto/moneda ausente en la
  respuesta del GET** (no verificable) → **saltear sin tocar la reserva** + alertar
  (fingerprint `reconcile-amount-unverifiable`), nunca confirmar ni flaggear a ciegas
  (mismo principio del 0013). El chequeo de (c) va al inicio de `recover()`, como
  short-circuit antes de comparar.

### Panel

- **i18n**: agregar la clave de estado `status-payment_mismatch` en **los dos namespaces
  que la usan** (el de la lista de reservas y el del detalle de reserva) en **ES y EN**
  → 4 entradas en total. Si falta la del detalle, `BookingDetailView` rompe con clave
  faltante.
- **Badge**: hoy `BookingsTable` usa un ternario binario (`Confirmed` vs genérico). Se
  convierte en un lookup por estado y se agrega una **clase CSS propia** para
  `payment_mismatch` (destacada, por ser anomalía de dinero — no dejarla en el badge
  gris genérico).
- El filtro de estado ya lo incluye solo (`Object.values(BookingStatus)`), sin cambios.

## 6. Modelo de datos

- **Tabla `bookings`**: sin columnas nuevas; se amplía el CHECK de `status` con
  `'payment_mismatch'`. Transición nueva: `pending_payment → payment_mismatch`.
- **Tabla `payments`**: sin cambios (no se marca; queda `pending` en un mismatch).
- **Función nueva**: `public.flag_payment_mismatch(uuid, int, text, text)`.
- **Migración**: `supabase/migrations/20260608000025_payment_mismatch.sql` (después de
  `…024`). El ALTER recrea el CHECK de `bookings.status` con los **5** valores
  (`pending_payment`, `confirmed`, `cancelled`, `refunded`, `payment_mismatch`).

## 7. Estados y transiciones

`bookings.status`: estado nuevo **`payment_mismatch`**.

- Transición: `pending_payment → payment_mismatch` (disparada por la validación en
  webhook o reconciliador).
- Es un estado de **retención para revisión manual**, no estrictamente terminal: el
  operador puede resolverlo por fuera. Ni el webhook ni el reconciliador ni
  `confirm_booking` lo tocan (todos operan sobre `pending_payment`/`confirmed`).
- No hay transición automática de salida (fuera de alcance).

## 8. Casos borde y errores

- **Race webhook vs reconciliador**: `flag_payment_mismatch` hace `FOR UPDATE` +
  chequeo `status='pending_payment'`; el segundo en llegar ve el estado ya cambiado y
  `RETURN false`. Idempotente.
- **Reentrega del webhook tras un flag**: el handler recompara (sigue sin cuadrar) y
  llama `flag_payment_mismatch`, que devuelve false (ya no está en `pending_payment`)
  → 200, sin loop.
- **Mismatch solo de moneda** (monto igual): es mismatch (comparación estricta).
- **OnvoPay no devuelve `amount` en el GET** (campo inesperado): si falta, tratarlo
  como **no verificable** → NO confirmar y NO flaggear a ciegas; saltear + alertar
  (mismo principio de seguridad del 0013). Confirmar el nombre del campo en la doc.
- **Reserva ya `confirmed`** cuando llega un webhook con monto distinto: `confirm_booking`
  es idempotente (RETURN si confirmada); el mismatch no revierte una confirmación
  previa. Caso muy improbable (un solo `succeeded` por intent); se audita igual desde
  el handler si se detecta antes de confirmar.
- **Pago no encontrado** (sin fila `payments`): el handler ya responde 404 (sin cambio).
- **Reconciliador flaggea y un webhook correcto llega después**: si el reconciliador
  marca `payment_mismatch` y luego llega (tarde) un webhook con monto correcto del mismo
  intent, `confirm_booking`/`flag_payment_mismatch` ya no la tocan (no está en
  `pending_payment`) → queda en `payment_mismatch` para revisión manual. Es aceptable y
  muy improbable (un solo `succeeded` por intent); el operador resuelve.

## 9. Impacto en otras áreas

- **Panel**: nueva etiqueta/badge `payment_mismatch` (i18n ES/EN). El filtro lo incluye
  solo. Sin otra UI.
- **Reportes (0012)**: ninguno cambia. Como el `payments.status` queda `pending`, no
  entra a `report_revenue` (cuenta `succeeded`), ni a ocupación (cuenta `confirmed`).
  En `report_refunds_summary`, la base de la tasa de cancelación es
  `status IN ('confirmed','cancelled','refunded')`, así que `payment_mismatch` **queda
  fuera** (no infla ni distorsiona la tasa). Correcto: un pago que no cuadra no es
  ingreso reconocido ni una reserva válida.
- **Acciones del panel ya apagadas para estados ≠ `confirmed`** (verificado): check-in y
  cancelación se muestran solo para `confirmed`, así que una reserva `payment_mismatch`
  no ofrece esas acciones — sin cambios necesarios.
- **Worker (0013)**: se extiende el cliente OnvoPay y el repo del reconciliador; el job
  gana una rama de validación antes de recuperar.
- **Webhook (0006/0011/#27)**: gana la validación antes de `confirm_booking`. No cambia
  la idempotencia.
- **audit_logs**: acción nueva `booking.payment_mismatch`.
- **Sentry**: dos alertas nuevas agrupadas (`webhook-payment-mismatch`,
  `reconcile-payment-mismatch`).
- **i18n**: textos nuevos para la etiqueta del estado (ES/EN).

## 10. Plan de tests

- **Unit (web)**: la decisión de comparación del handler (igual → confirma; distinto →
  flag) con el cliente DB mockeado. Mapeo del estado nuevo.
- **Unit (worker)**: `getPaymentIntent` devuelve `amountCents`/`currency`; la rama del
  reconciliador que compara y decide confirmar vs flaggear (repo + Sentry mockeados).
- **Integración (web)** contra DB real: `flag_payment_mismatch` deja la reserva en
  `payment_mismatch`, audita, no toca `payments` ni cupo; idempotencia (`RETURN false`
  sobre una reserva ya flaggeada o ya confirmada). Webhook con monto distinto → flag;
  con monto igual → confirma.
- **Integración (worker)**: reserva vencida con OnvoPay `succeeded` pero monto distinto
  → `payment_mismatch` (no confirmada, no recuperada en loop); con monto igual → se
  recupera como hoy.
- **Casos borde obligatorios (dinero)**: (a) **mismatch solo de moneda** (monto igual,
  moneda distinta) → flag, en integración; (b) **monto/moneda ausente en el GET** del
  worker → skip sin tocar la reserva + alerta, sin confirmar ni flaggear.
- **Manual (PR)**: sandbox OnvoPay, simular un `succeeded` con monto alterado (o un
  `payments.amount_cents` distinto sembrado) y verificar el flag + la alerta.

## 11. Plan de rollout

- **Feature flag**: no. Reversible quitando la validación de los dos callers y la
  migración (forward-only; el estado nuevo no se usaría).
- **Migración de datos**: ninguna. No hay reservas `payment_mismatch` históricas.
- **Comunicación a operadores**: avisar que aparece un estado nuevo "pago en revisión"
  y qué significa (pago no coincidente, requiere acción manual).
- **Orden**: depende de 0013 y #27 ya mergeados (lo están). La migración va después de
  `…024`.

## 12. Métricas de éxito

- 0 reservas confirmadas con `payment.amount_cents` distinto del monto reportado por
  OnvoPay (verificable con una consulta de auditoría).
- Todo mismatch queda registrado (`audit_logs` + Sentry) y visible en el panel.

## 13. Preguntas abiertas

Ninguna. La única pregunta (el campo de monto/moneda del `GET /v1/payment-intents/:id`)
se resolvió el 2026-06-08 contra la doc oficial de OnvoPay: son **`amount`** (entero,
unidad menor = céntimos) y **`currency`** (3 letras), los mismos campos que ya consume
el adaptador del webhook.
