# Changelog — 0014 Validación de monto del pago

Spec: [0014-validacion-monto-webhook.md](./0014-validacion-monto-webhook.md)
Rama: feat/0014-validacion-monto-webhook

## 2026-06-08 — Implementación

**Hecho**:

- **DB** (`20260608000025_payment_mismatch.sql`): amplía el CHECK de `bookings.status`
  con `payment_mismatch`; función atómica `flag_payment_mismatch(p_booking_id,
p_paid_amount_cents, p_paid_currency, p_source) RETURNS boolean` (SECURITY DEFINER +
  search_path='' + REVOKE). `FOR UPDATE` + guard de `pending_payment` (idempotente,
  race-safe); marca `payment_mismatch`, **no toca `payments`** (queda `pending` → no es
  ingreso) ni `capacity_reserved`; audita `booking.payment_mismatch` (`actor_type=system`,
  `actor_id` NULL) con esperado vs pagado.
- **shared**: `BookingStatus.PaymentMismatch`.
- **web/types/database.ts**: valor en la unión `bookings.status` + función
  `flag_payment_mismatch` (a mano, narrow).
- **Webhook** (`web/app/api/webhooks/onvopay/route.ts`): select extendido a
  `amount_cents, currency`; antes de `confirm_booking`, si `payload.amountCents/currency`
  ≠ esperado → `flag_payment_mismatch` (source `webhook`) + Sentry warning
  (`webhook-payment-mismatch`) + 200. El reconciliador es la red de respaldo si el flag
  fallara.
- **Worker (reconciliador 0013)**: `getPaymentIntent` ahora devuelve `amountCents`/
  `currency` (campos `amount`/`currency` del GET, confirmados en la doc de OnvoPay);
  `fetchStalePendingBookings` trae `payments(amount_cents, currency)`; `recover()` valida
  antes de confirmar: (a) sin monto en el GET → no verificable, saltea + alerta
  (`reconcile-amount-unverifiable`); (b) monto/moneda distintos → `flag_payment_mismatch`
  (source `reconcile`) + alerta (`reconcile-payment-mismatch`); (c) coincide → recupera.
- **Panel**: i18n `status-payment_mismatch` en ES/EN, en **los dos namespaces** (lista +
  detalle). Badge propio (`.badgeMismatch`, color warning) — el ternario binario de
  `BookingsTable` pasó a lookup. El filtro de estado lo incluye solo (`Object.values`).

**Por qué / decisiones**:

- **Validación en los DOS caminos** (webhook + reconciliador): si solo validara el
  webhook, una reserva con monto incorrecto quedaría en `pending_payment` y el
  reconciliador la confirmaría después (la ve `succeeded`), salteándose el chequeo.
- **Estado propio `payment_mismatch`** (no `cancelled`, no quedarse en `pending_payment`):
  saca la reserva de `pending_payment` para que el reconciliador no la levante ni entre
  en loop, sin cancelarla (el dinero llegó a OnvoPay; lo resuelve el operador).
- **`payments` queda `pending`**: el dinero está en OnvoPay pero el sistema NO lo
  reconoce como venta válida → no entra a `report_revenue` (cuenta `succeeded`).
- **Comparación estricta** (monto y moneda exactos, sin tolerancia) — decisión del
  usuario. El pago es de monto fijo que arma el checkout.
- **Alertas a Sentry** (no email): anomalía de salud para revisión, no evento accionable
  automático.

**Tests** (suite verde, `db reset` + cadena completa, 25 migraciones):

- **Unit worker (64, +3)**: árbol de decisión de `recover()` — monto coincide → recupera;
  monto distinto → `flag_payment_mismatch`; moneda distinta → mismatch; **sin monto en el
  GET → no verificable, saltea**. `onvopay` devuelve amount/currency.
- **Integración web (106, +3)**: `flag_payment_mismatch` marca `payment_mismatch`, no toca
  `payments`, audita esperado vs pagado; idempotencia (`false` sobre ya-flaggeada);
  `false` sobre una reserva ya `confirmed`.
- **Integración worker (15, +1)**: `succeeded` con monto distinto → `payment_mismatch` (no
  confirma, cupo intacto, pago `pending`, audita); con monto igual → recupera.
- La comparación del **handler** del webhook es la misma lógica de 2 líneas cubierta por
  el unit del worker y por la función en integración; no se agregó un test del route
  handler aislado (consistente con el repo, que solo testea el adaptador en unit).
- Web unit 92, lint 0 err, typecheck limpio.

**Pendiente**:

- Nada para mergear. Manual sugerido en el PR (sandbox OnvoPay con monto alterado).
- Deuda relacionada que NO cubre este spec (anotada en pre-production-checklist): el
  `eventId = data.id` de OnvoPay; este spec no lo toca.

## 2026-06-08 — Review de subagentes (payment-flow-auditor, db-schema-guardian, code-reviewer) + ajustes

Los tres corrieron sobre el diff. **Sin bloqueantes.** Incorporado:

- **Normalización de moneda** (riesgo medio del payment-auditor): la comparación estricta
  de `currency` era sensible a mayúsculas → si OnvoPay devolviera `'usd'` en vez de
  `'USD'`, TODO pago legítimo se marcaría mismatch (falso positivo masivo). Ahora ambos
  callers comparan `.toUpperCase()` (ISO 4217 es case-insensitive). Test nuevo lo cubre.
- **Test del route handler del webhook** (lo marcaron 2 reviewers, dominio crítico):
  `web/tests/integration/webhook-handler.test.ts` mockea el provider + Sentry y pega al
  POST real contra la DB — monto distinto → 200 + `payment_mismatch` sin confirmar; monto
  igual → confirma; **moneda `usd` → normaliza y confirma**.
- **`flagError` → Sentry** en el webhook (antes solo `console.error`): se agrega al scope
  de la alerta para no perder visibilidad de un fallo del flag.
- **`DROP CONSTRAINT IF EXISTS`** en la migración (robustez ante drift, consistente con el
  resto del repo).

**Diferido (anotado, no alcanzable hoy)**: guard de `payment_mismatch` dentro de
`confirm_booking` como defensa en profundidad (hoy ningún caller llega ahí con mismatch;
relevante solo si se agregara un 3er caller, p. ej. "confirmar a mano" en el panel).

Suite tras ajustes: web unit 92 / integ **109** (+3), worker unit 64 / integ 15. Lint 0,
typecheck limpio.
