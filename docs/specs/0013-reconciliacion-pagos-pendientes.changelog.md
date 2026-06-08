# Changelog — 0013 Reconciliación de pagos pendientes

Spec: [0013-reconciliacion-pagos-pendientes.md](./0013-reconciliacion-pagos-pendientes.md)
Rama: feat/0013-reconciliacion-pagos-pendientes

## 2026-06-08 — Implementación

**Hecho**:

- **DB** (`20260608000023_cancel_stale_pending_booking.sql`): función atómica `cancel_stale_pending_booking(p_booking_id, p_reason) RETURNS boolean`. `SECURITY DEFINER` + `SET search_path=''` + `REVOKE EXECUTE FROM PUBLIC` (endurecimiento del 0011). Cancela una reserva `pending_payment` (con `SELECT ... FOR UPDATE` + re-chequeo de estado → idempotente y seguro ante la race con el webhook), marca el pago `pending → failed`, expira el hold defensivamente, audita `booking.expired_pending` (`actor_type='system'`). Devuelve `false` si la reserva ya no estaba en `pending_payment`.
- **worker/reconciliation/onvopay.ts**: cliente de payment intents (espejo del de refunds). `getPaymentIntent(id)` → `GET /v1/payment-intents/:id`, `Bearer`, `AbortSignal.timeout(15s)`. Mapea el estado de OnvoPay a un enum de decisión `PaymentIntentOutcome` (Paid/NotPaid/Pending) vía lookup map (no literales, por la regla de lint). Estado desconocido → Pending (nunca cancelar a ciegas).
- **worker/reconciliation/repository.ts**: `fetchStalePendingBookings` (embed de `payments`), `cancelStaleBooking` (RPC, devuelve boolean), `confirmRecoveredBooking` (reusa `confirm_booking`, el llamador calcula seats igual que el webhook), `writeRecoveredAudit` (`booking.recovered_via_reconcile`, best-effort).
- **worker/jobs/reconcile-pending-payments.ts**: job con single-flight a nivel módulo (`isRunning`), lote de 50, umbral 2h. Árbol de decisión: sin pago → cancelar; sin `ONVOPAY_SECRET_KEY` → saltear (nunca a ciegas); `succeeded` → recuperar (confirm + audit + alerta Sentry `reconcile-recovered`); `canceled`/`requires_payment_method` → cancelar con el estado crudo como reason; `processing`/`requires_action`/desconocido → saltear, y si >24h estancado, alerta Sentry `reconcile-stuck-processing`. Errores por reserva aislados (no abortan el lote). Registrado en `index.ts` cada 5 min.

**Por qué / decisiones**:

- **Reconciliación, no solo limpieza**: el caso común de abandono deja `payments` en `pending`, ambiguo entre "abandonó el widget" y "pagó pero el webhook se perdió". Consultar OnvoPay (`GET payment-intent`) es la única forma segura de distinguirlos; de paso recupera reservas pagadas con webhook perdido (el peor enredo: el turista pagó y no recibió nada). Seguridad del dinero como criterio rector.
- **No decrementa `capacity_reserved`** (diferencia clave con `cancel_booking` del 0011): una reserva `pending_payment` nunca lo incrementó (solo `confirm_booking` lo hace).
- **Alertas a Sentry, no email al operador** (decisión del usuario): una recuperación es señal de salud del sistema, no un evento accionable; agrupadas por fingerprint para no spamear.
- **`processing` estancado >24h → revisión manual** (decisión del usuario): nunca se auto-cancela; solo se hace visible en Sentry.
- **Constantes (umbrales) en el worker, NO en `shared`** (corrección durante la implementación): el worker es self-contained y **no resuelve el alias `@shared` en runtime** (`tsx`/`node dist`); importar de shared pasaría typecheck y tests pero rompería en runtime. El spec asumía `shared`; se corrigió el spec (§5/§6). Solo el worker usa estos umbrales, así que viven en el job.

**Tests**:

- **Unit worker (60, +12, corridos verde)**: `reconciliation/onvopay.test.ts` (mapeo de los 5 estados + desconocido; `getPaymentIntent` parseo OK y throw en no-ok vía fetch stub) y `reconciliation/reconcile-pending-payments.test.ts` (árbol de decisión completo con repo + Sentry mockeados, incluye fingerprints y cálculo de seats).
- **Integración worker (`reconcile-pending-payments.test.ts`, 6 — total worker integ 13, +6, corridos verde con `db reset` + cadena completa)**: sin pago → cancelada + audit + cupo intacto; `succeeded` → confirmada + cupo +1 + `booking_confirmation` encolada + audit recovered; `canceled` → cancelada + pago `failed`; `processing` → intacta; reciente (<umbral) → no entra al lote; idempotencia (`cancel_stale_pending_booking` sobre confirmada devuelve false).
- **Suite completa verde (2026-06-08, `db reset` con las 23 migraciones)**: web unit 92 / integ 99, worker unit 60 / integ 13. Typecheck limpio, lint 0 errores. (Nota de entorno: Docker Desktop se cayó a mitad de sesión y rearrancó solo; la integración se corrió tras recuperarlo.)

**Pendiente**:

- Nada para mergear. PR a `dev`.
