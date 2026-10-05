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

## 2026-10-05 — Términos versión 2026-10-05

Decisión del usuario: los términos dicen lo que hace el programa; los redacta el operador y la
abogada los confirma. Solo hay reembolso cuando el turista cancela una reserva cobrada con 24
horas o más, o cuando el operador cancela y decide devolver.

**Hecho**: versión nueva de los términos (`web/content/legal/terms/2026-10-05.{es,en}.ts`,
`TERMS_VERSION`, registro y espejo del worker). La 2026-09-27 queda publicada para las reservas
que la aceptaron. Cambios frente a la 2026-09-27:

- **Cláusula 4**: el apartado de 15 minutos también vence si no se guarda la tarjeta; el sitio
  avisa si el cobro es al reservar o después; cuándo queda confirmada la reserva en cada caso;
  las reservas en línea cierran unas horas antes de la salida.
- **Cláusula 5**: párrafos nuevos sobre el cobro posterior a la reserva: tarjeta guardada y
  autorización, sin cobro al reservar, cuándo se confirma una salida y cuándo se cobra, la
  retención previa, y qué pasa si el banco rechaza el cobro o pide confirmarlo.
- **Cláusula 6**: las condiciones de 24 horas aplican a la reserva ya cobrada; sin reembolso una
  vez iniciado el tour; la reserva sin cobrar se cancela en cualquier momento sin costo; no se
  puede cancelar con un cobro en proceso; el cambio de fecha es para reservas ya cobradas.
- **Cláusula 7**: bajo el mínimo, el operador decide si la salida se hace o se cancela; si la
  cancela, aviso de 24 horas y 100 %; si se hace, la reserva sigue y se cobra; la reserva que no
  llegó a cobrarse antes del inicio se cancela sin cobro. En clima, seguridad y fuerza mayor: la
  revisión es de las reservas cobradas, no se cancela desde el sitio durante la revisión y la no
  cobrada se cancela sin cobro.
- **Cláusula 8**: solo hay reembolso en los casos de las cláusulas 5, 6, 7 y 9, y siempre por el
  100 %, sin descuentos.

También: el aviso del checkout diferido ya no dice "cuando la salida alcance el mínimo" sino
"cuando la salida se confirme", y nombra la retención. Arreglo de paso: la action de cancelar una
salida rechazaba el motivo "Fuerza mayor" que el diálogo ofrece.

**Sin tocar, para decidir con la abogada**: la cláusula 16 ("nada en ellos limita los derechos que
la ley le reconoce como consumidor") y la 13 (Comisión Nacional del Consumidor).
