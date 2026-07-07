# Changelog — 0028 Cierre de hallazgos del code review integral

Spec: [0028-cierre-hallazgos-code-review-integral.md](./0028-cierre-hallazgos-code-review-integral.md)
Ramas: `fix/0028-dinero` (workstream A), `fix/0028-panel-portal` (workstream B), `chore/0028-deuda-menor-ci` (workstream C)

## 2026-07-06 — Workstream A implementado (dinero); integración corriendo

**Hecho**:

- Migración `20260706000040`: `confirm_booking` → `RETURNS text` con outcome, gate real por evento (`processed_webhook_events` con INSERT verificado), camino `late_payment_refunded` (pago `succeeded` + refund total + audit), asientos derivados de la reserva (`p_total_seats` deprecated con DEFAULT NULL), audit en camino feliz, liberación de hold en mismatch; `flag_payment_mismatch` también libera el hold. REVOKE re-aplicado + GRANT explícito a service_role.
- Checkout (`create.ts`): INSERT de `payments` chequeado; si falla → `cancelPaymentSession` best-effort (método nuevo en `PaymentProvider` + adapter) + release inmediato del hold; el widget jamás recibe un intent no persistido.
- Webhook: `maybeSingle` + error de query → 500; lectura de `bookings` eliminada; consume el outcome (alertas por fingerprint: late/overbooked/ignored).
- Reconciliador: `confirmRecoveredBooking` devuelve el outcome (sin `p_total_seats`, sin re-lectura de status); `recover()` extraído a `reconciliation/recover.ts` y alertas a `reconciliation/alerts.ts` (límite 150 líneas).
- Refunds worker: camino verify para `pending` con `external_refund_id` (jamás re-POST), `ambiguous-timeout` → failed + Sentry error, backoff real 1/5/30 desde `updated_at`, `markProcessing` con retry + alerta crítica con el id, guard `isRunning`, aislamiento por ítem; `processOne` extraído a `refunds/handle-refund.ts`. Retry manual web (`retry-action.ts`): con `external_refund_id` → `processing` (verify), sin id → `pending`.
- Notifications worker: timeout 15s en Resend y mailpit, guard `isRunning`, try/catch por ítem (poison pill → transitorio del ítem), off-by-one del backoff corregido (3 reintentos reales 1/5/30), escrituras chequeadas, `markSent` fallido → Sentry error sin re-envío.
- Worker `index.ts`: scheduler unificado + graceful shutdown SIGTERM/SIGINT (espera ciclos en curso, tope 30s).
- Env worker: `ONVOPAY_SECRET_KEY` y `EMAIL_PROVIDER=resend` obligatorios en producción; `ONVOPAY_API_BASE_URL` nueva (default prod) consumida por los 3 clientes OnvoPay (web adapter + 2 worker); `.env.example` ×2 actualizados.
- `shared/`: `ConfirmBookingOutcome` nuevo, `NotificationKind.OverbookedRefunded`, `AuditAction` completado; `web/types/database.ts` editado A MANO (outcome union, `p_total_seats` opcional).
- Tests: unit worker 81 ✓ (nuevos: backoff-no-elapsed, ambiguous-timeout, pending-con-id→verify, markProcessing fallido; actualizados: backoff off-by-one citando spec, reconcile outcome-driven); unit web 183 ✓ (nuevo `init-checkout-failures.test.ts` ×4); integración nueva `late-payment-refund.test.ts` (late+idempotencia+concurrencia+mismatch-monto, asientos autoritativos, hold liberado ×2).

**Por qué / decisiones**:

- `markProcessing` fallido tras POST exitoso NO libera el claim (release → pending sin id → re-POST → doble refund); se reintenta una vez y se alerta con el `external_refund_id` en el mensaje para resolución manual.
- `markSent` fallido tras enviar NO reintenta el envío (el Idempotency-Key de Resend acota el reenvío del próximo ciclo; con mailpit —solo dev— puede duplicar). Alerta `notif-mark-sent-failed`.
- Clientes OnvoPay reciben `baseUrl` por parámetro (no importan env): quedan puros y testeables.

**Pendiente**:

- Correr `test:integration` (web + worker) contra la migración `…040` local; reviews obligatorios (code-reviewer, db-schema-guardian, payment-flow-auditor); PR.

## 2026-07-06 — Spec aprobado, arranca workstream A (dinero)

**Hecho**:

- Code review integral ejecutado con 5 subagentes (reporte entregado en sesión; hallazgos resumidos en la memoria `pre-production-checklist`).
- Spec 0028 escrito, revisado por spec-reviewer en dos rondas (2 bloqueantes de diseño resueltos: semántica de precios base+temporada con prioridad determinista, y gate de idempotencia por evento en `confirm_booking`) y aprobado por Kenneth.

**Por qué / decisiones**:

- Tres PRs secuenciales en vez de uno gigante (precedente spec 0023).
- Precios: se conserva "base + temporadas" y la temporada gana (opción b del spec-reviewer); la alternativa (prohibir coexistencia) cambiaba el modelo que el formulario ya permite.
- Reserva `cancelled` con pago tardío reembolsado termina `refunded` vía `settle_refund` (semántica 0011 existente, no se pelea contra el pipeline).

**Pendiente**:

- Implementar A1–A8 en `fix/0028-dinero` (migración `20260706000040` + web + worker + tests).
