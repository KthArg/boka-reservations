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
