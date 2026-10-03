# 0044 — Vigencia de los horarios del tour desde el formulario

- **Estado**: approved
- **Autor**: Kenneth (con Claude Code)
- **Creado**: 2026-10-03
- **Última actualización**: 2026-10-03
- **Rama**: feat/0044-vigencia-de-horarios
- **PR**: (sin asignar)

## 1. Contexto y motivación

Cada horario de un tour (`tour_schedules`: día de la semana, hora, capacidad) genera salidas para los próximos 90 días (`generate-tour-instances`). La base ya sabe limitar un horario en el tiempo (`valid_from`, `valid_until`, spec 0028) y el generador lo respeta, pero el formulario del tour no muestra esas fechas: todo horario que se agrega desde el panel rige desde hoy y para siempre.

Eso tiene dos consecuencias, que aparecieron en la prueba del cobro diferido del 2026-10-01:

- No hay forma de agregar un horario para una temporada o una fecha puntual: un horario de un solo jueves generó salidas todos los jueves hasta fin de año.
- Desactivar un horario no saca las salidas que ya generó. Quedaron 36 salidas futuras reservables en el sitio público, y no se pueden quitar desde el panel: un horario con salidas no se puede eliminar, y cancelarlas obliga a hacerlo de a una desde Salidas.

Actores: **admin**, el único que edita tours (`updateTour` exige el rol admin); **turista**, que no debería ver fechas que el operador ya no ofrece.

## 2. Objetivos

- Permitir fijar desde el formulario desde qué día y hasta qué día rige cada horario.
- Retirar de la venta, al guardar el tour, las salidas futuras sin reservas que quedan fuera de la vigencia de su horario o cuyo horario se desactivó.
- Avisar al admin, al guardar, de las salidas fuera de vigencia que no se pudieron retirar.

## 3. Fuera de alcance

- No se cancelan ni se mueven salidas con reservas vivas: esas las decide el staff desde Salidas, con las herramientas que ya existen (cancelar salida, reprogramar).
- No se agregan excepciones por fecha (feriados, "este jueves no"): se resuelven cancelando esa salida desde Salidas.
- No se cambia el horizonte de 90 días del generador.
- **Cambiar el día o la hora de un horario que ya tiene salidas no retira las viejas.** Las salidas existentes siguen en su día y hora, y el generador crea las nuevas. Para cambiar el día o la hora, se desactiva el horario y se crea otro. El formulario lo advierte junto a esos campos en filas que ya existen.
- No se habilita al staff a editar tours.

## 4. Historias de usuario

> Como operador, quiero indicar desde y hasta cuándo rige un horario, para ofrecer temporadas o fechas puntuales sin que se generen salidas de más.

- [ ] Cada fila de horario del formulario muestra "Desde" y "Hasta" (fechas, día calendario de Costa Rica). "Desde" vacío significa "desde hoy"; "Hasta" vacío significa "sin fin".
- [ ] El formulario rechaza un "Hasta" anterior al "Desde" efectivo (hoy en CR si "Desde" está vacío), también en filas nuevas. El error se muestra en el formulario, como los demás errores de horarios.
- [ ] Un horario con "Desde" y "Hasta" en el mismo día genera una sola salida, si ese día coincide con su día de la semana, después de la siguiente corrida de `generate-tour-instances`.
- [ ] Las filas existentes muestran sus fechas actuales; guardar sin tocarlas no las cambia.

> Como operador, quiero que al acortar o desactivar un horario sus salidas futuras sin reservas dejen de venderse, para no tener que cancelarlas de a una.

- [ ] Al guardar el tour, toda salida futura de un horario desactivado, o cuyo día (CR) cae fuera de la vigencia de su horario, queda cancelada y deja de mostrarse en el sitio público, si no tiene nada vivo encima (ver §5).
- [ ] Las salidas fuera de vigencia que no se pudieron retirar no cambian. En ese caso, o si el retiro falla, el formulario no redirige: se queda en la edición del tour y muestra cuántas salidas se retiraron, cuántas quedaron y un enlace a Salidas. Si todo se retiró, redirige a la lista de tours como hoy.
- [ ] Cada salida retirada queda auditada (`departure.withdrawn`, una fila por salida), con el horario, el motivo y el admin.

## 5. Diseño técnico

- **Formulario** (`web/components/tours/ScheduleEditor.tsx`): dos campos de fecha por fila. El esquema (`ScheduleRowSchema`) y el mapeo (`mapSchedules`) ya aceptan `valid_from` y `valid_until`. La validación `hasInvalidScheduleRange` pasa a comparar contra el "Desde" efectivo (`valid_from ?? hoy en CR`) y se aplica también a las filas inactivas que tengan las dos fechas.
- **Retiro de salidas**: función SQL nueva `withdraw_schedule_instances(p_tour_id uuid, p_actor_id uuid) RETURNS jsonb`, con el patrón de las funciones privilegiadas (`SECURITY DEFINER`, `search_path = ''`, guard `is_public_request()`, `REVOKE` a `PUBLIC, anon, authenticated`, `GRANT` a `service_role`). Exige que `p_actor_id` sea un admin activo.
  - **Candidatas**: salidas del tour con `starts_at > now()` y `status <> 'cancelled'` (incluye `full`), cuyo horario está inactivo o cuyo día `(starts_at AT TIME ZONE 'America/Costa_Rica')::date` cae fuera de `valid_from`/`valid_until`, con bordes inclusivos (espejo exacto de `withinValidity` del generador).
  - Se bloquean con un solo `SELECT … ORDER BY id FOR UPDATE`, el mismo orden que usa `reschedule_booking`, para no producir un deadlock con una reprogramación entre dos salidas del tour.
  - **Se retira** una candidata solo si, bajo el lock: no tiene reservas vivas (`confirmed`, `pending_minimum`, `pending_payment`, y también `payment_mismatch`, que espera revisión manual); no tiene apartados vivos (`active` con `expires_at > now()`, o `paying`, el mismo criterio que `create_hold_atomic`); y no tiene un ciclo del mínimo abierto (`minimum_charge_triggered_at IS NULL`, o con `minimum_resolved_at` o `minimum_charge_closed_at` no nulos). Esta última condición es la misma que protege el archivado (`hasChargingDeparture`): el motor del cobro diferido no mira salidas canceladas, y un ciclo abierto podría tener retenciones vivas que nadie soltaría.
  - Retirar = `status = 'cancelled'`, `cancellation_reason = 'schedule_withdrawn'` (explícito: el trigger de …049 pondría `other` si llegara nulo) y una fila de auditoría `departure.withdrawn` con `actor_type` admin.
  - Devuelve `{ "withdrawn": n, "kept": m }`.
- **Llamada**: `updateTour` (`web/lib/tours/actions.ts`) la llama después de guardar los horarios, con el cliente de servicio y el admin como actor. El `ActionResult` de éxito se amplía con los conteos opcionales; la acción redirige solo si `kept = 0` y no hubo error.
- **Generador**: sin cambios. Respeta la vigencia y no recrea salidas canceladas (el upsert ignora duplicados por `schedule_id, starts_at`).
- **Motivo nuevo** `schedule_withdrawn` en el CHECK `tour_instances_cancellation_reason_check` (…049). Todos los consumidores de `cancellation_reason` lo aceptan sin romperse: `shared/constants/operations.ts`, `web/types/database.ts`, `CancelDepartureDialog`, las etiquetas del panel en `locales` y, en el worker, `notifications/render.ts`, `prepare-cancellation.ts` y `templates/departure-cancelled.ts` (que no deberían recibirlo, porque una salida retirada no tiene reservas, pero no fallan si lo reciben).

## 6. Modelo de datos

- **Tabla**: `tour_instances` — **Acción**: alter — el CHECK `tour_instances_cancellation_reason_check` suma `schedule_withdrawn`.
- **Función nueva**: `withdraw_schedule_instances(uuid, uuid)`.
- **Migración**: `supabase/migrations/20261003000056_vigencia_de_horarios.sql`, con respaldo previo de producción.
- Sin columnas ni índices nuevos: `tour_schedules.valid_from` y `valid_until` ya existen.

## 7. Estados y transiciones

Salida (`tour_instances.status`): `available` o `full` → `cancelled` con motivo `schedule_withdrawn`, solo si se cumplen las tres condiciones de §5. Este spec no reabre salidas retiradas. (El archivado de tours sí puede reabrir salidas canceladas al deshacerse; no se cambia.)

## 8. Casos borde y errores

- **Una reserva o un apartado entra mientras se guarda el tour**: la función toma la salida con `FOR UPDATE` y vuelve a contar reservas y apartados bajo el lock; `create_hold_atomic` también toma la salida y rechaza una cancelada. Gana quien llegue primero; nunca queda una reserva sobre una salida retirada.
- **Reprogramación concurrente hacia una salida retirada**: `reschedule_booking` rechaza un destino cancelado. El orden de locks por id evita el deadlock.
- **Salida con el ciclo del mínimo abierto**: no se retira y se cuenta en `kept`. Se resuelve desde Salidas.
- **"Hasta" anterior a hoy**: retira desde hoy inclusive, también las salidas de hoy que todavía no empezaron. "Hasta" = hoy conserva las salidas de hoy.
- **Horario reactivado después de un retiro**: las salidas retiradas siguen canceladas (el generador no las recrea); las fechas nuevas dentro de la vigencia se generan en la próxima corrida diaria del worker.
- **Fecha puntual cercana**: la salida aparece recién después de la próxima corrida del generador (al arrancar el worker y cada 24 horas), y puede quedar dentro de la anticipación mínima para reservar (spec 0041).
- **El generador corre mientras se guarda el tour**: puede insertar salidas con la vigencia vieja después del retiro. Se corrige volviendo a guardar el tour, que es idempotente.
- **Guía asignado a una salida retirada**: la salida desaparece de su vista (solo muestra salidas vigentes). No tenía turistas.
- **Horario borrado**: `tour_instances.schedule_id` es `ON DELETE CASCADE`, así que borrar un horario cuyas salidas no tienen reservas borra esas salidas; con reservas, el borrado falla (FK de `bookings`) y el formulario pide desactivarlo. El retiro de este spec actúa sobre lo que queda.
- **Error al retirar**: los horarios ya se guardaron; el formulario muestra el error y se puede volver a guardar.

## 9. Impacto en otras áreas

- **Panel**: formulario del tour (fechas por horario, advertencia al editar día u hora, resultado del retiro).
- **Portal**: las salidas retiradas dejan de mostrarse (filtra por `status = available`).
- **Worker**: sin cambios de comportamiento.
- **Reportes**: las salidas retiradas no tienen reservas; no cambian ingresos ni ocupación.
- **i18n**: textos nuevos ES y EN, incluida la etiqueta del motivo `schedule_withdrawn`.

## 10. Plan de tests

- **Unit**: la validación con "Desde" vacío y "Hasta" en el pasado (rechazada); mapeo de fechas vacías.
- **Integración (SQL)**: retiro por horario inactivo y por vigencia; borde del día en CR (salida a las 23:30 CR, que en UTC ya es el día siguiente); salida con reserva viva, con apartado activo, con apartado vencido sin liberar (se retira) y con reserva cancelada (se retira); salida con el ciclo del mínimo abierto (no se retira); idempotencia; concurrencia con `create_hold_atomic`; actor que no es admin (rechazado); permisos de la función.
- **Integración (web)**: guardar un tour con un horario acotado devuelve los conteos y no redirige cuando quedan salidas.
- **Manual (en el PR)**: crear un horario de un solo día, reiniciar el worker y ver una sola salida; desactivarlo y ver que desaparece del calendario público.

## 11. Plan de rollout

- Sin feature flag.
- Migración antes del código, con respaldo de producción.
- Al desplegar, guardar una vez el tour de prueba retira las salidas sobrantes de los horarios temporales del 2026-10-01.
- Reversión: `DROP FUNCTION withdraw_schedule_instances`; las salidas retiradas pasan a `cancellation_reason = 'other'` antes de devolver el CHECK a su forma anterior; para reabrir alguna, `UPDATE … SET status = 'available'` (el trigger de …049 limpia el motivo).

## 12. Métricas de éxito

- Cero salidas reservables de horarios inactivos o fuera de vigencia, salvo las que tienen reservas y figuran en el aviso.
- El operador crea horarios de temporada sin pedir ayuda técnica.

## 13. Preguntas abiertas

Ninguna.
