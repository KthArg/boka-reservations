# Changelog — 0011 Cancelaciones con refund automático

Spec: [0011-cancelaciones-refund-automatico.md](./0011-cancelaciones-refund-automatico.md)
Rama: feat/0011-cancelaciones-refund-automatico

## 2026-06-02 14:45 — Implementación completa, lista para PR

**Hecho**:

- **DB** (`20260602000018`): tablas `refunds`, `audit_logs`, `booking_access_tokens` + función atómica `cancel_booking` (libera cupo, cancela recordatorio, encola email y refund en una transacción). Extendió `notifications.kind`.
- **shared**: `policies.computeRefund` (regla 24h aislada y testeada), `RefundStatus`, `AuditAction/ActorType`, `CancellationError/RefundRetryError`, 2 `NotificationKind`.
- **Token de acceso a la reserva** hasheado (`hashBookingToken`/`validateBookingToken`), espejo del de guías. Resuelve el 404 del link "ver mi reserva" de los emails.
- **Motor** `lib/booking/cancel.ts` (`getBookingView` + `cancelBooking`) + `lib/audit/log.ts`. Server Actions: `cancelByToken` (turista), `cancelByStaff`, `retryRefund`.
- **Worker**: cliente de refunds OnvoPay (`refunds/onvopay.ts`), job `process-refunds` (polling: pending→POST→processing→poll GET→succeeded/failed), templates `cancellation-confirmation` y `refund-confirmation` ES/EN, emisión de token + link `/booking/[token]`.
- **UI**: páginas públicas `/booking/[token]` (ver) y `/booking/[token]/cancel` (con "tenés derecho a reembolso: SÍ/NO"). Panel: botón cancelar + estado del refund + retry manual. i18n `cancellation` + claves de refund (ES/EN).

**Por qué / decisiones**:

- **Refund client en el worker, no en el `PaymentProvider` de web** (corrección del diseño durante implementación, ver spec §5). El reembolso lo dispara el job; el worker es self-contained y ya tiene `ONVOPAY_SECRET_KEY`. Web nunca llama a OnvoPay para reembolsar.
- **OnvoPay refunds sin webhook** (vetting): el resultado se obtiene por polling de `GET /v1/refunds/:id`, no por callback.
- **`p_actor_id` reordenado a último con `DEFAULT NULL`** para que el tipo generado lo marque opcional (turista/sistema sin actor).
- **`web/types/database.ts`**: el CLI 2.101 ensancha columnas con CHECK a `string`; se restauró el archivo de `dev` y se agregaron las entidades nuevas en estilo union para no regresionar el contrato de tipos del resto del repo.

**Pendiente**:

- Nada — feature lista para PR. Política de reembolso definitiva del cliente y trato de comisión de OnvoPay quedan como preguntas abiertas del spec (no bloquean; binaria 24h parametrizable mientras tanto).

**Notas para retomar**:

- Tests: web unit 83, web integ 94, worker unit 45, worker integ 5 — todo verde (suite corrida 2026-06-02). El worker debe estar corriendo para que los refunds avancen (polling 60s), igual que los emails.
