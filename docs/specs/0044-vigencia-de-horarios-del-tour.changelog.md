# Changelog — 0044 Vigencia de los horarios del tour

Spec: [0044-vigencia-de-horarios-del-tour.md](./0044-vigencia-de-horarios-del-tour.md)

## 2026-10-03 — Implementación

**Hecho**:

- Migración `…056`: el CHECK de `tour_instances.cancellation_reason` suma `schedule_withdrawn`, y
  la función `withdraw_schedule_instances` retira las salidas futuras fuera de vigencia o de
  horarios inactivos que no tienen reservas vivas, apartados vivos ni un ciclo del mínimo abierto.
  Bloqueo único ordenado por id, día en hora de Costa Rica con bordes inclusivos, solo admin.
- Formulario del tour: "Desde" y "Hasta" por horario, con la explicación de la vigencia y el
  aviso de que cambiar día u hora no mueve las salidas existentes.
- `hasInvalidScheduleRange` compara contra el "Desde" efectivo (vacío = hoy en CR) y en todas las
  filas.
- `updateTour` llama al retiro después de guardar los horarios (`web/lib/tours/withdraw.ts`). Con
  salidas que no pudo retirar no redirige y muestra los conteos con un enlace a Salidas; si el
  retiro falla, lo informa y volver a guardar lo reintenta.
- Etiquetas del motivo nuevo y textos ES y EN.
- Tests: 9 de integración de la función (vigencia, horario inactivo, borde del día en CR, reserva
  viva, reserva cancelada, apartado vivo y vencido, ciclo abierto, idempotencia, actor no admin),
  el de permisos de la función, el de la acción que devuelve los conteos sin redirigir y 4
  unitarios de la validación.
