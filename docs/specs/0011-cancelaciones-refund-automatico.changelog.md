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

## 2026-06-05 — Validación en vivo (navegador + OnvoPay sandbox real) y fix

Probado end-to-end en navegador contra el **sandbox real de OnvoPay** (tarjeta `4242…`, webhook vía ngrok confirmando la reserva). Los tres caminos del refund quedaron validados:

1. **Refund exitoso (turista vía link del email)**: reserva real → cancelación por el token de `/booking/[token]` → worker `POST /v1/refunds` real → `external_refund_id` real → polling a `succeeded` → `booking/payment → refunded`, email `refund_confirmation` enviado, refund visible en el dashboard OnvoPay. Auditoría: `booking.cancelled (tourist)`, `refund.requested`, `refund.succeeded`.
2. **Refund fallido + retry (pago ficticio)**: con un `paymentIntentId` inexistente, OnvoPay responde `404 payment_intents.not_found`; el worker reintenta hasta `MAX_CREATE_ATTEMPTS` (3) y marca el refund `failed`; el panel muestra "Falló" + botón "Reintentar". Camino de error confirmado.
3. **Cancelación por staff con refund exitoso (panel)**: idéntico al 1 pero `actor_type=staff`.

**Bug hallado y corregido (fix `182306e`)**: la tabla `refunds` no tenía política RLS de lectura → el detalle del panel (que lee con la sesión del admin, no `service_role`) no veía la fila y la sección "Refund" nunca aparecía. Se agregó `refunds_select_admin_staff` (mismo patrón InitPlan que `payments`/`bookings`/`notifications`). **Los tests de integración no lo detectaban** porque leen vía `service_role`, que ignora RLS — gotcha guardado en memoria del proyecto.

**Edge case observado (no es bug, decisión de producto)**: si el turista cancela dentro del ciclo de ~60s antes de que el worker despache la confirmación, el `booking_confirmation` se **cancela** en vez de enviarse (guard del 0007: solo se manda si la reserva sigue `confirmed`). El cliente recibe solo el email de cancelación. Defendible (ya vio la confirmación en pantalla al pagar). Si se quisiera siempre enviar la confirmación, se cambiaría el guard.
