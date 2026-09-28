# Changelog — 0035 Operación prometida en los términos

Spec: [0035-operacion-prometida-en-los-terminos.md](./0035-operacion-prometida-en-los-terminos.md)
Rama: feat/0035-operacion-de-los-terminos (apilada sobre feat/0034-terminos-definitivos)

## 2026-09-27 — Implementación completa

**Hecho**:

- **Migración `…049`**: `tour_instances.cancellation_reason`, `bookings.operator_review_required_at`
  (solo con `confirmed`), `refunds` con `awaiting_transfer`, método y datos de transferencia (con
  CHECK de coherencia), tres kinds de notificación, y las funciones `cancel_departure`,
  `resolve_immediate_minimum`, `keep_departure`, `refund_reviewed_booking`,
  `close_reviewed_booking_without_refund`, `reschedule_booking`, `request_refund_transfer`,
  `settle_refund_transfer`, más el trigger `tours_meeting_point_lock`.
- **Worker**: job `resolve-minimum` cada 5 minutos (ventana de 24 a 25 h; alerta a Sentry una vez
  por salida atrasada bajo el mínimo); avisos `departure_cancelled`, `booking_rescheduled` y
  `refund_transfer_request`; el comprobante de reembolso nombra el canal de la transferencia;
  `Reply-To` al correo de contacto del operador en todos los correos.
- **Panel**: en Salidas, bandejas "Reservas en revisión" y "Salidas bajo el mínimo" (Mantener /
  Cancelar) y "Cancelar salida" en cada fila, con el efecto de cada motivo explicado antes de
  confirmar. En el detalle de la reserva: decisión de revisión, cambio de fecha, y pedir y
  registrar la devolución por transferencia.
- **Tours**: el formulario ya no ofrece "Cancelar automáticamente" (la regla la fijan los
  términos) y muestra un error claro si el punto de encuentro está bloqueado.
- **Turista**: una reserva en revisión muestra el aviso y no se puede cancelar desde el enlace
  (`CancellationError.UnderReview`).

**Decisiones**:

- **Cancelar por mínimo con menos de 24 h se rechaza también para el staff**
  (`minimum_too_late`): los términos prometen ese aviso. Con menos, se cancela por otra causa,
  que reembolsa el 100 %.
- **Las reservas del cobro diferido en una salida cancelada reciben el aviso nuevo**, no el de
  mínimo: nombra el motivo real.
- **Un aviso repetido (segundo cambio de fecha, salida cancelada tras un cambio) se vuelve a
  encolar** sobre la misma fila: la unicidad `(booking_id, kind)` no puede tragarse un cambio.
- **La reserva en revisión no se cancela por otro camino**: el CHECK de la marca lo impide en la
  base, y el panel oculta la cancelación normal.
- **Reply-To para todos los correos**, no solo para el pedido de datos: cualquier respuesta del
  turista le llega al operador.
- **Cambiar de fecha una salida ya empezada se rechaza** (`source_started`), salvo una reserva en
  revisión.

**Pendiente**:

- Las horas del corte (24 y 25) están espejadas en el worker (`resolve-minimum.ts`), en
  `shared/constants/operations.ts` y en la SQL. Si cambia una, cambian todas.
- El registro de alertas atrasadas es por proceso: un reinicio del worker puede repetir una
  alerta (la issue de Sentry es la misma por fingerprint).

## 2026-09-27 — Correcciones de las revisiones

Revisiones de db-schema-guardian, payment-flow-auditor y code-reviewer sobre el PR #85. El spec
registra los cambios de regla al principio.

**Hecho**:

- `notifications.generation` y guardas por generación en el worker: reencolar un aviso ya no
  choca con la clave de idempotencia de Resend ni deja que un "sent" viejo pise el pendiente.
- `cancel_booking` redefinida en `…049`: salida antes que reserva (sin deadlock contra
  `cancel_departure`) y `under_review` explícito.
- `confirm_booking` redefinida: un pago sobre una salida cancelada cancela la reserva y sigue por
  el pago tardío, que la reembolsa entera. `cancel_departure` deja los pagos en curso del widget
  al reconciliador.
- Transferencia solo con rechazo definitivo de OnvoPay (o pago inexistente), con monto y moneda,
  y fecha de pago no anterior al pedido.
- `force_majeure`, margen de 10 minutos, motivo de cancelación por trigger con backfill,
  punto de encuentro con `SECURITY DEFINER` y reservas pendientes, `payment_mismatch` en el audit.
- Worker: lote de 200 en `resolve-minimum`, variante del correo de cierre tras revisión, tipos y
  TTL sin duplicar. `retryRefund` no audita un reintento que perdió la carrera.
- Web: reembolsos del detalle ordenados (el último primero), destinos de cambio de fecha solo
  con cupo, rótulo "En revisión" para el turista, texto correcto cuando el mínimo ya se resolvió.
- Tests: concurrencia (dos cambios de fecha por el último cupo, registrar la transferencia dos
  veces, mantener contra el proceso), captura en curso, bordes de la ventana, pago acreditado
  después de cancelar la salida, generación de avisos, y el job contra la base real (reemplaza al
  test con cliente simulado).

**Decisiones**:

- **Reply-To en todos los correos al turista y a los guías**: cualquier respuesta le llega al
  operador; no hay otra dirección que atienda.
- **Deadlock residual con `confirm_booking` del flujo diferido** (bloquea reserva y después
  salida): el flag está apagado y Postgres aborta una de las dos; se revisa si se enciende.

**Pendiente**:

- Una bandeja de reembolsos `failed` y `awaiting_transfer` fuera del detalle de cada reserva.
