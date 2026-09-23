# Changelog — 0032 Reembolso sin la comisión de procesamiento

Spec: [0032-reembolso-sin-comision-procesamiento.md](./0032-reembolso-sin-comision-procesamiento.md)
Rama: feat/0032-reembolso-sin-comision (apilada sobre fix/0031-cierre-legal-lanzamiento)

## 2026-09-22 — Implementación completa

**Hecho**:

- **Política** (`shared/constants/policies.ts`):
  - `computeProcessingFee`: 3,9 % + US$0,35, con aritmética entera.
  - `computeRefund` con motivo, moneda, versión de términos y corte inyectable.
  - `REFUND_FEE_FROM_TERMS_VERSION = null`: la política queda desplegada inactiva.
- **Motivos y resultados** (`shared/constants/cancellations.ts`):
  - `CancellationReason` y `CancelBookingOutcome`.
  - Errores nuevos: `ReasonRequired`, `OperatorRefundAdminOnly` y `StateChanged`.
- **Migración `…046`**:
  - `refunds.processing_fee_cents`, con CHECK nombrado.
  - Sobrecarga de `cancel_booking` de 6 parámetros:
    - valida el motivo, la comisión y los montos;
    - `operator_decision` exige el total, y el monto más la comisión no pueden superar el total;
    - si se aplica el tope por lo cobrado, la comisión se recorta;
    - audita el motivo y la comisión;
    - devuelve `cancelled` o `already_cancelled`.
  - `report_revenue` corregido (ver decisiones).
- **Web**:
  - `cancel.ts`: motivo, restricción de admin cuando la salida ya empezó, y verificación de lo que vio quien cancela (`StateChanged`).
  - `booking-view.ts`: la vista se separa de `cancel.ts` por el límite de líneas y calcula el reembolso solo si la reserva está confirmada; un error de configuración no tira la página.
  - Server actions con Zod.
  - Página de cancelación y `CancelConfirm` con la comisión descontada.
  - Aviso en el checkout (`refund-fee-notice.ts`, dentro de `ConsentField`), visible solo con la política activa.
  - Moneda del checkout unificada en `CHECKOUT_CURRENCY`, e `intlLocaleTag` en `lib/format/money.ts`.
- **Panel**:
  - `CancelPaidBookingDialog`, con el `<dialog>` nativo y sin opción preseleccionada: muestra los montos por motivo y envía el monto que se mostró.
  - `CancelBookingButton` queda solo para reservas sin cobrar.
  - El rol se resuelve una vez en la página del detalle.
- **Worker**: `loadLatestRefund` lee `processing_fee_cents`, y las plantillas de cancelación y de reembolso muestran la comisión descontada.
- **Tests**:
  - Unitarios:
    - política (20 casos);
    - aviso del checkout;
    - `cancelBooking` con la base mockeada: carrera, error de comisión, borde exacto de la restricción de admin y `StateChanged`;
    - plantillas.
  - Integración:
    - política activa por server actions, incluida la carrera real con `Promise.all`;
    - validaciones de la función SQL;
    - permisos de la sobrecarga;
    - reportes con pago `refunded`.
- **Prueba manual** (Supabase local, web en el puerto 3100):
  - Con un staff sobre una salida ya empezada, "Por decisión del operador" aparece deshabilitada con su leyenda.
  - Sobre una salida futura, el staff canceló por decisión del operador y el resultado quedó bien: reserva cancelada, reembolso de 6000 con comisión 0 y bitácora con `operator_decision`.
  - La página de cancelación del turista carga.
  - Con la política activada de forma temporal, el aviso del checkout sale debajo de la casilla de términos, fuera del `<label>` y con `aria-describedby`.

**Por qué / decisiones**:

- **`StateChanged`**: la auditoría de pagos encontró que el turista podía confirmar la cancelación de una reserva que se cobró mientras tenía la página abierta. Se le retenía el dinero y la pantalla decía "no se cobró nada". Ahora el cliente envía lo que vio (estado y monto), y si cambió no se cancela.
- **`report_revenue`**: el bruto contaba solo pagos `succeeded`, y `settle_refund` pasa el pago a `refunded`. Cada reembolso se restaba dos veces: con uno total, el neto daba −total. Era un bug previo; se corrige en la 046 porque los reembolsos parciales lo agravaban. El test de reportes sembraba un estado imposible (pago `succeeded` con reembolso acreditado).
- **Invariantes de montos en la base**: el reembolso total del operador queda garantizado en la base y no solo en la app.
- **Textos de los emails**: no dicen que la pasarela no devuelve la comisión, porque ese supuesto sigue sin confirmar (spec §13).
- **Formato de los montos**: el aviso usa el del locale ("3,9%" y "USD 0,35" en ES), no el literal del spec. El spec quedó actualizado.

**Pendiente**:

- Decisión anotada en el spec §13: un staff puede reembolsar el total "por decisión del operador" dentro de las 24 h previas a la salida.
- Anotado, fuera de alcance:
  - la bitácora de la cancelación no guarda la versión de corte ni `is_admin`;
  - `refund.requested` se audita aunque el `ON CONFLICT` no inserte (comportamiento previo);
  - `loadLatestRefund` toma la última fila de cualquier estado;
  - el panel no muestra la comisión.
- Prueba manual en el sandbox de OnvoPay de un reembolso parcial: antes de activar la política.
- PR (lo mergea el usuario), después del PR #74 del spec 0031.
