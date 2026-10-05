# Changelog — 0045 Política de las salidas bajo el mínimo

Spec: [0045-politica-salidas-bajo-el-minimo.md](./0045-politica-salidas-bajo-el-minimo.md)

## 2026-10-05 — Implementación

**Hecho**:

- Migración `…057`: `business_settings.below_minimum_policy` (`staff_decides` por defecto, o
  `auto_cancel`) y `resolve_immediate_minimum` reescrita. Una salida sin ninguna reserva viva se
  cancela sola entre 25 y 24 horas antes con cualquier política; una con reservas solo se cancela
  sola con `auto_cancel`. Con un apartado vivo o una reserva `payment_mismatch` no se cancela en
  esa corrida.
- Worker, cobro diferido: `decideRelease` recibe la política. Con `auto_cancel` el motor cancela
  al vencer el plazo de cobro solo si soltó todas las retenciones en esa corrida, no quedó ningún
  cupo cobrado ni autorizado y faltan más de 24 horas 10 minutos. `releaseAll` informa si quedó
  algo vivo. Una salida sin cupos vendidos ya no alerta "espera decisión".
- `auto_cancel_departure_minimum` (hallazgo del auditor de pagos): las guardas de la cancelación
  automática del diferido se repiten en la base, bajo el lock de la salida. Sin ella, el motor
  podía cancelar la reserva de un turista del cobro inmediato que estaba pagando en el widget.
- Worker, `resolve-minimum`: la alerta de salida atrasada baja a `warning` cuando la política es
  `staff_decides` y la salida tiene cupos cobrados.
- Configuración: campo "Salidas bajo el mínimo" (solo admin).
- Salidas: la bandeja "Salidas bajo el mínimo" ya no lista salidas vacías y su texto depende de
  la política; "Salidas que esperan decisión" no lista salidas sin reservas vivas.

**Decisiones del usuario (2026-10-05)**:

- Las salidas con reservas y bajo el mínimo las decide el staff en los dos cobros. Al principio
  el operador va a aceptar varias salidas bajo el mínimo.
- Las salidas sin ninguna reserva se cancelan solas 24 horas antes.
- Volver a la cancelación automática tiene que ser un cambio en el panel, sin deploy.

**Decisiones de implementación**:

- Las salidas vacías de tours sin mínimo (`min_participants <= 1`) no se cancelan: siguen a la
  venta hasta la anticipación mínima.
- Si nadie decide una salida del cobro inmediato, la salida se hace.

**Pendiente**:

- La cláusula 7 de los términos dice "la cancelamos"; con `staff_decides` una salida bajo el
  mínimo puede hacerse igual. Queda para la revisión de la abogada.
