# 0035 — Operación prometida en los términos: mínimo, cancelación de salidas, cambio de fecha y devolución por transferencia

- **Estado**: approved
- **Autor**: Claude (con decisiones del usuario del 2026-09-27)
- **Creado**: 2026-09-27
- **Última actualización**: 2026-09-27
- **Rama**: feat/0035-operacion-de-los-terminos
- **PR**: (cuando aplique)

Aprobación: el usuario pidió el 2026-09-27 que la plataforma funcione hoy como dicen los términos del spec 0034 y tomó las decisiones de la sección 1. Revisado por spec-reviewer el mismo día; los hallazgos críticos están resueltos en este texto.

## 1. Contexto y motivación

Los términos del spec 0034 prometen cosas que hoy la plataforma no hace en el cobro inmediato, que es el que se lanza. La cancelación por mínimo solo existe dentro del motor del cobro diferido (spec 0033), que está apagado: en el cobro inmediato nadie mira el mínimo. Tampoco se puede cancelar una salida entera, mover una reserva a otra fecha, ni devolver dinero fuera de la tarjeta.

Decisiones del usuario (2026-09-27):

- **Mínimo, con 24 horas de aviso, y la venta se cierra.** Toda salida que a esa hora no alcanza su mínimo se cancela, también las vacías. Las que lo alcanzan siguen a la venta hasta la hora de inicio.
- **Nunca se cancela por mínimo con menos de 24 horas.** Si el proceso no llegó a tiempo (worker caído), la salida se hace y queda una alerta.
- **Clima, seguridad o fuerza mayor: sin reembolso automático.** El turista reserva bajo su propio riesgo. La salida se cancela y cada reserva pasa a revisión en el panel, donde el equipo decide entre reembolso del 100 %, cambio de fecha o ningún reembolso.
- **Cualquier otra cancelación del operador: 100 % automático.**
- **Admin y staff** pueden cancelar salidas, decidir las reservas en revisión y registrar transferencias.
- **Cambio de fecha**: se construye.

Riesgo que el usuario conoce: no devolver el dinero de un tour que no se hizo puede considerarse incumplimiento bajo la Ley 7472; la fuerza mayor lo atenúa pero no lo garantiza. El texto aprobado ofrecía "otra fecha o el reembolso, a su elección".

## 2. Objetivos

- Cancelar automáticamente, con al menos 24 horas de aviso, toda salida que no alcance su mínimo y que el staff no haya decidido mantener, con reembolso del 100 % y correo.
- Permitir cancelar una salida entera con un motivo; por clima o seguridad, dejar cada reserva en revisión para que el equipo decida.
- Permitir mover una reserva a otra salida del mismo tour sin cobro ni reembolso.
- Impedir, en la base, que cambie el punto de encuentro de un tour con reservas futuras.
- Completar un reembolso por transferencia o SINPE Móvil cuando la tarjeta no lo acepta, sin riesgo de pagar dos veces.

## 3. Fuera de alcance

- El motor del cobro diferido (spec 0033) no cambia; el proceso nuevo ignora las salidas con reservas del flujo diferido.
- El turista no cambia la fecha por su cuenta: lo pide por correo y lo hace el staff.
- La transferencia la hace el operador desde su banco; la plataforma la registra.
- Los datos de la cuenta no se guardan en un formulario: el turista responde el correo con ellos y el staff registra solo el comprobante.
- Reembolso parcial de una reserva (por ejemplo, una de tres personas): el reembolso por decisión del operador es siempre del total (contrato de `cancel_booking` de `…046`).
- Facturación electrónica y notas de crédito (spec 0037).

## 4. Historias de usuario

> Como turista, quiero enterarme con al menos 24 horas si mi tour no sale por falta de gente, y recibir todo lo que pagué.

- [ ] El proceso resuelve cada salida cuando faltan entre 24 y 25 horas para su inicio: la hora extra es margen para que el correo salga antes del límite.
- [ ] Si los cupos cobrados alcanzan el mínimo (o el mínimo es 1), la salida queda resuelta como alcanzada y sigue a la venta.
- [ ] Si no, la salida se cancela (también si está vacía), cada reserva cobrada recibe el 100 %, y cada turista recibe un solo aviso de cancelación que nombra el motivo y el monto. El recordatorio de 24 horas no llega a enviarse.
- [ ] Una salida sin resolver a la que le quedan menos de 24 horas nunca se cancela por mínimo: se hace y se alerta a Sentry.

> Como staff, quiero mantener una salida bajo el mínimo o cancelar una salida por otro motivo.

- [ ] La bandeja de `/dashboard/departures` muestra las salidas bajo el mínimo cuyo corte (inicio menos 25 horas) cae en las próximas 72 horas, con "Mantener" y "Cancelar".
- [ ] "Mantener" la resuelve como confirmada por el staff; el proceso ya no la toca.
- [ ] Cada salida futura tiene "Cancelar salida" con motivo obligatorio: falta de mínimo, clima, seguridad, u otra causa del operador.
- [ ] Por falta de mínimo u otra causa, cada reserva cobrada recibe el 100 % al instante.
- [ ] Por clima o seguridad, la salida se cancela, las reservas cobradas quedan en revisión sin reembolso, y el turista recibe un correo que dice que su reserva está en revisión y que le escribiremos con la decisión.

> Como staff, quiero decidir cada reserva en revisión.

- [ ] Las reservas en revisión aparecen en una sección propia de la bandeja y en su detalle, con tres acciones: reembolsar el 100 %, pasar a otra fecha o cerrar sin reembolso.
- [ ] Cada decisión quita la marca de revisión, queda auditada con quién la tomó y le manda al turista el correo correspondiente.
- [ ] El turista no puede cancelar desde su enlace una reserva en revisión: la pantalla le explica que estamos revisando su caso.

> Como staff, quiero pasar una reserva a otra fecha cuando el turista lo pide.

- [ ] El detalle de una reserva confirmada ofrece "Cambiar fecha" con las salidas futuras, no canceladas, del mismo tour con cupo.
- [ ] El cupo se cuenta igual que al apartar: capacidad menos cupos cobrados menos apartados vivos.
- [ ] Mover no cobra ni reembolsa, libera el cupo de la salida original, ocupa el de la nueva, reprograma el recordatorio (o crea uno nuevo si el anterior ya salió), quita la marca de revisión si la había, y manda al turista la fecha nueva.

> Como operador, quiero que el punto de encuentro no cambie para quien ya reservó.

- [ ] Un UPDATE de `meeting_point_es` o `meeting_point_en` en un tour con reservas confirmadas en salidas futuras falla en la base, venga del panel o de PostgREST, y el panel muestra un mensaje que lo explica.

> Como staff, quiero devolver el dinero por transferencia cuando la tarjeta no lo acepta.

- [ ] "Devolver por transferencia" solo aparece en reembolsos `failed` sin `external_refund_id` y sin un motivo de resultado desconocido: en esos dos casos OnvoPay todavía puede acreditar a la tarjeta y transferir pagaría dos veces.
- [ ] La acción deja el reembolso `awaiting_transfer` y le pide al turista, por correo, los datos de una cuenta a su nombre.
- [ ] "Registrar transferencia" pide canal (SINPE Móvil o transferencia bancaria), fecha (no futura) y comprobante; deja el reembolso `succeeded` con método `transfer`, la reserva `refunded` y el pago `refunded`, y le manda al turista la confirmación con el canal.
- [ ] El worker nunca toma un reembolso `awaiting_transfer`.

## 5. Diseño técnico

**Constante del aviso.** `MINIMUM_NOTICE_HOURS = 24` y `MINIMUM_RESOLUTION_MARGIN_MINUTES = 60` en SQL. No se usa `minimum_decision_window_hours`: `…047` dejó escrito que es el plazo de recuperación del cobro diferido y que mezclarlos haría que cambiar uno mueva el otro.

**Función `cancel_departure(p_instance_id, p_reason, p_actor_id)`** (`SECURITY DEFINER`, patrón `…044`). `p_reason IN ('minimum','weather','safety','other')`; actor nulo solo con `minimum`. Bajo `FOR UPDATE` de la instancia (siempre primero la instancia, después las reservas, el mismo orden que `reschedule_booking`):

1. Rechaza con `capture_in_progress` si hay una captura del motor diferido en curso.
2. Reservas `confirmed`:
   - motivo `minimum` u `other`: `cancel_booking` de 6 parámetros con `operator_decision`, comisión 0 y el total; después marca `cancelled` su `cancellation_confirmation` pendiente, para que llegue un solo aviso de cancelación;
   - motivo `weather` o `safety`: la reserva sigue `confirmed` con `operator_review_required_at = now()`, se cancela su recordatorio pendiente y no hay reembolso.
3. Reservas `pending_payment` del cobro inmediato (un pago en curso en el widget): pasan a `cancelled` y su pago pendiente a `failed`, sin cerrar en la pasarela. Si el turista termina de pagar, entra por el camino de pago tardío de `…040`, que reembolsa solo. Las del flujo diferido se cancelan como hoy con `cancel_booking_for_departure`.
4. Encola `departure_cancelled` para cada reserva afectada que tenga correo (el correo lee el motivo de la instancia y si la reserva quedó en revisión).
5. Instancia `cancelled`, `cancellation_reason = p_reason`. Con motivo `minimum` estampa también la resolución (`auto_cancelled` sin actor, `staff_cancelled` con actor).
6. Audita `departure.cancelled` con motivo y conteos.

Devuelve `cancelled`, `already_cancelled` o `capture_in_progress`. Las reservas en `payment_mismatch` no se tocan: tienen su propio circuito en el panel.

**Función `resolve_immediate_minimum(p_instance_id)`**, solo para el worker. Bajo lock verifica que falten entre 24 y 25 horas, que no esté resuelta ni cancelada y que no tenga reservas del flujo diferido (`deferred_flow`). Con `min_participants <= 1` o `capacity_reserved >= min_participants`, resuelve `reached` estampando disparo y foto (el CHECK de `…047` exige el disparo para `reached`). Si no, `cancel_departure(..., 'minimum', NULL)`. Devuelve `reached`, `cancelled`, `already_resolved`, `not_due` o `deferred_flow`.

**Función `keep_departure(p_instance_id, p_actor_id)`**: resuelve `staff_confirmed` con disparo y foto. Devuelve `resolved` o `already_resolved`.

**Job `resolve-minimum`**, cada 5 minutos, fuera del flag del cobro diferido:

- toma las salidas no canceladas, sin resolver, que empiezan entre 24 y 25 horas desde ahora, y llama a `resolve_immediate_minimum` para cada una; como todas quedan resueltas o canceladas, el lote no se traba;
- además busca las sin resolver con menos de 24 horas, mínimo mayor que 1 y bajo el mínimo, y alerta a Sentry una vez por salida.

**Decisiones sobre reservas en revisión** (funciones con actor obligatorio): `refund_reviewed_booking` (llama a `cancel_booking` con `operator_decision`), `close_reviewed_booking_without_refund` (cancela sin reembolso y encola `cancellation_confirmation`, cuyo texto ya contempla "sin reembolso") y el cambio de fecha. Las tres exigen la marca y la limpian.

**Función `reschedule_booking(p_booking_id, p_target_instance_id, p_actor_id)`**: bloquea las dos instancias en orden de id y después la reserva. Valida reserva `confirmed`, mismo tour, destino futuro no cancelado y cupo con la fórmula de `create_hold_atomic` (capacidad menos reservados menos holds `active` o `paying`). Mueve `capacity_reserved`, actualiza `tour_instance_id`, reprograma el `reminder_24h` pendiente o reemplaza el ya enviado, limpia la marca de revisión y encola `booking_rescheduled`. El precio no cambia aunque la fecha nueva tenga otra temporada. Devuelve `rescheduled`, `not_confirmed`, `same_instance`, `different_tour`, `target_unavailable` o `no_capacity`.

**Punto de encuentro**: trigger `BEFORE UPDATE` en `tours` que rechaza (`MEETING_POINT_LOCKED`) cambios a `meeting_point_es/en` si existe una reserva `confirmed` en una salida futura. La acción del panel traduce el error a `TourActionError.MeetingPointLocked`.

**Devolución por transferencia.** Columnas en la sección 6.

- `request_refund_transfer(p_refund_id, p_actor_id)`: solo desde `failed`, con `external_refund_id IS NULL` y `failure_reason` fuera de los motivos de resultado desconocido (`REFUND_MANUAL_CHECK_REASONS`). Pasa a `awaiting_transfer` y encola `refund_transfer_request`.
- `settle_refund_transfer(p_refund_id, p_actor_id, p_channel, p_reference, p_paid_at)`: solo desde `awaiting_transfer`; canal válido, comprobante no vacío, fecha no futura. Tiene su propio UPDATE (no puede reusar `settle_refund`, que sale si el reembolso no está `processing`): reembolso `succeeded` con método y datos; pago `refunded`; reserva `refunded`, salvo que esté `overbooked_refunded`, que se conserva. Encola la confirmación del reembolso.

**Correos nuevos** (ES y EN, con el pie del spec 0034):

- `departure_cancelled`: motivo; monto devuelto, o "tu reserva quedó en revisión; te escribiremos con la decisión" para clima y seguridad; enlace para ver otras fechas.
- `booking_rescheduled`: fecha nueva, punto de encuentro y enlace de la reserva.
- `refund_transfer_request`: monto y pedido de los datos de una cuenta a nombre de quien reservó; se responde al correo de contacto del operador (`Reply-To`).

`refund-confirmation` suma la variante por transferencia.

**Panel.** Todas son server actions con Zod y rol admin o staff, con el patrón de `decision-action.ts`:

- `/dashboard/departures`: la bandeja suma "Salidas bajo el mínimo" y "Reservas en revisión"; cada fila futura tiene "Cancelar salida".
- Detalle de la reserva: "Cambiar fecha", las tres decisiones de revisión, y en reembolsos fallidos "Devolver por transferencia" y "Registrar transferencia".
- El formulario del tour deja de mostrar "Cancelar automáticamente" (la columna queda para el motor diferido).

**Pantalla del turista.** Una reserva en revisión muestra "Cancelamos la salida por {motivo}. Estamos revisando tu reserva y te escribiremos con la decisión", sin botón de cancelar. `cancelByToken` la rechaza con `CancellationError.UnderReview`.

## 6. Modelo de datos

- **Tabla** `tour_instances` — alter: `cancellation_reason text NULL`, CHECK `IN ('minimum','weather','safety','other')`.
- **Tabla** `bookings` — alter: `operator_review_required_at timestamptz NULL`; CHECK: solo con `status = 'confirmed'`.
- **Tabla** `refunds` — alter:
  - `status` suma `awaiting_transfer`;
  - columnas `method text NOT NULL DEFAULT 'card'` (CHECK `IN ('card','transfer')`), `transfer_channel text NULL` (CHECK `IN ('sinpe_movil','bank_transfer')`), `transfer_reference text NULL`, `transfer_requested_at timestamptz NULL` y `transfer_paid_at timestamptz NULL`;
  - CHECK de coherencia: `method = 'transfer' AND status = 'succeeded'` exige canal, comprobante y fecha.
- **Tabla** `notifications` — `notifications_kind_check` suma `departure_cancelled`, `booking_rescheduled` y `refund_transfer_request`.
- **Tabla** `tours` — trigger `tours_meeting_point_lock`.
- **Funciones**: `cancel_departure`, `resolve_immediate_minimum`, `keep_departure`, `refund_reviewed_booking`, `close_reviewed_booking_without_refund`, `reschedule_booking`, `request_refund_transfer`, `settle_refund_transfer`.
- **Migración**: `supabase/migrations/20260927000049_operacion_de_los_terminos.sql`.

## 7. Estados y transiciones

- `refunds`: `failed → awaiting_transfer → succeeded` (método `transfer`).
- `tour_instances`: `available|full → cancelled` con motivo.
- `bookings`:
  - `confirmed` (sin marca) → `confirmed` en revisión (salida cancelada por clima o seguridad);
  - desde revisión: `cancelled` (con reembolso → `refunded` al acreditarse), `cancelled` sin reembolso, o `confirmed` en otra salida;
  - el cambio de fecha no cambia el estado.

## 8. Casos borde y errores

- **El staff mantiene una salida mientras corre el proceso**: el lock de la instancia serializa; quien llega segundo recibe `already_resolved`.
- **Una reserva cancelada por el turista en el mismo minuto**: `cancel_booking` es idempotente y el recuento no la incluye.
- **Salida con reservas del flujo diferido**: el proceso la saltea (`deferred_flow`); la resuelve el motor del spec 0033.
- **Recordatorio**: con el corte a 25 horas, la cancelación ocurre antes que el recordatorio de las 24 horas, y `cancel_booking` lo cancela.
- **Pago en curso al cancelar la salida**: entra por pago tardío y se reembolsa solo.
- **Cambio de fecha a la misma salida, a otro tour, a una cancelada o sin cupo**: rechazo sin cambios.
- **Correo vacío (reserva anonimizada)**: no se encola aviso; cancelación y reembolso ocurren igual.
- **Transferencia pedida sobre un reembolso que OnvoPay todavía puede acreditar**: la función la rechaza.
- **El turista no responde el pedido de datos**: el reembolso queda `awaiting_transfer` y aparece en el panel hasta que se registre.

## 9. Impacto en otras áreas

- Panel: bandeja con dos secciones nuevas, "Cancelar salida", "Cambiar fecha", decisiones de revisión y acciones de transferencia.
- Worker: job `resolve-minimum` y plantillas nuevas.
- Reportes: una reserva en revisión cuenta como cobrada hasta que se decida; los reembolsos por transferencia cuentan igual que los de tarjeta.
- Tours: el formulario pierde una casilla y muestra el error del punto de encuentro.

## 10. Plan de tests

- Integración SQL:
  - `cancel_departure` por cada motivo, con reservas cobradas, en curso y mezcladas: reembolso exacto o marca de revisión, un solo aviso de cancelación, instancia cancelada, idempotencia y guarda de captura;
  - `resolve_immediate_minimum`: alcanzado, no alcanzado, vacía, dentro y fuera de la ventana, flujo diferido, mínimo 1;
  - `keep_departure` y la carrera con el proceso;
  - `reschedule_booking` en todos sus outcomes, con los cupos de las dos salidas y un hold vivo en la de destino;
  - las tres decisiones de revisión;
  - transferencia completa, y los rechazos por estado, por `external_refund_id` y por motivo desconocido;
  - trigger del punto de encuentro.
- Worker: el job resuelve solo la ventana de 24 a 25 horas y alerta las atrasadas.
- Web: acciones con Zod y permisos; cancelación del turista bloqueada en revisión.
- Permisos: las ocho funciones nuevas en `rpc-execute-grants`.

## 11. Plan de rollout

- Sin feature flag. El proceso del mínimo empieza con el worker, que tiene que estar corriendo en producción antes de abrir la venta (checklist de lanzamiento).
- Migración antes del código.
- Reversible: quitar el job del scheduler; las funciones nuevas solo las usan estas acciones.

## 12. Métricas de éxito

- Ninguna salida bajo el mínimo llega a su hora sin estar resuelta, salvo las alertadas.
- Ninguna reserva en revisión lleva más de 5 días sin decisión.

## 13. Preguntas abiertas

Ninguna.
