# 0041 — Anticipación mínima para reservar

- **Estado**: approved
- **Autor**: Claude (con decisiones del usuario del 2026-09-29)
- **Creado**: 2026-09-29
- **Última actualización**: 2026-09-29
- **Rama**: feat/0041-anticipacion-minima
- **PR**: (cuando aplique)

Revisado por spec-reviewer el 2026-09-29; los hallazgos están resueltos en este texto.

## 1. Contexto y motivación

Hoy una salida se puede reservar en línea hasta el minuto en que empieza: `create_hold_atomic` solo rechaza las que ya empezaron (`HOLD_INSTANCE_PAST`). Una reserva de último momento complica la logística: el guía puede haber salido, falta equipo o la persona no llega al punto de encuentro.

El usuario decidió (2026-09-29):

- Una anticipación mínima **global** (no por tour), **configurable** desde Configuración, con **3 horas** de valor inicial.
- Las salidas que se cancelan por no alcanzar el mínimo no se pueden reservar. Esto **ya ocurre**: la salida pasa a `cancelled`, desaparece del calendario y `create_hold_atomic` la rechaza (`HOLD_INSTANCE_UNAVAILABLE`). El spec lo deja escrito y lo cubre con un test.

## 2. Objetivos

- Cerrar la venta en línea de cada salida una cantidad configurable de horas antes de que empiece.
- Que el admin ajuste esa cantidad desde el panel, sin tocar código.
- Que el turista no vea ni pueda intentar reservar una salida ya cerrada.

## 3. Fuera de alcance

- Anticipación distinta por tour.
- Cambios en la cancelación por mínimo (spec 0035) o en su horario.
- Reservas que hace el admin desde el panel: el cambio de fecha (`reschedule_booking`) no pasa por `create_hold_atomic` y no se limita.
- Horas de cierre por día de la semana o feriados.
- `checkAvailability` (`lib/booking/availability.ts`), que hoy solo usan los tests.
- Frenar un checkout ya empezado: el corte se controla al crear el apartado (§5).

## 4. Historias de usuario

> Como admin, quiero definir hasta cuántas horas antes de la salida se puede reservar en línea, para tener tiempo de organizar cada salida.

- [ ] En Configuración hay un campo "Reservas en línea hasta … horas antes de la salida", con valor inicial 3.
- [ ] Acepta enteros de 0 a 72; fuera de rango, el panel muestra el error y no guarda.
- [ ] Con 0, se puede reservar hasta la hora de salida (el comportamiento de hoy).
- [ ] Como los demás campos de Configuración, queda quién hizo el último cambio y cuándo (`updated_by`, `updated_at`).

> Como turista, quiero ver solo las salidas que todavía puedo reservar, para no empezar una reserva que no se va a poder completar.

- [ ] El calendario del tour no muestra las salidas que empiezan dentro de la anticipación mínima.
- [ ] Si abro el checkout de una salida disponible pero ya cerrada (un enlace viejo, una página abierta hace rato), veo "Esta salida ya no acepta reservas en línea" con un enlace al calendario del tour. Una salida cancelada, ya pasada o inexistente sigue dando 404, como hoy.
- [ ] Si la salida se cierra antes de que confirme mis datos (antes de que se cree el apartado), no se crea nada y veo el mismo aviso.
- [ ] Si ya empecé a pagar (el apartado se creó antes del cierre), puedo terminar: hasta 15 minutos en el cobro diferido (vida del apartado) y hasta que se confirme el pago en el inmediato. Es la regla habitual de respetar un pago en curso.

> Como turista, no quiero poder reservar una salida que se canceló por no alcanzar el mínimo.

- [ ] Una salida cancelada no aparece en el calendario y el checkout la rechaza (comportamiento actual, ahora con test).

## 5. Diseño técnico

- **Dato**: `business_settings.booking_cutoff_hours integer NOT NULL DEFAULT 3`, con `CHECK` entre 0 y 72. Se edita con el cliente del admin, con un `GRANT UPDATE` de la columna, igual que `minimum_decision_window_hours` (migración …043).
- **Control en la base**: `create_hold_atomic` lee `booking_cutoff_hours` y rechaza con `HOLD_BOOKING_CLOSED` si `starts_at <= now() + cutoff horas`. Todo el código de checkout (inmediato y diferido) pasa por ahí; `create_deferred_booking` no crea apartados por su cuenta. Orden de las verificaciones: `HOLD_INSTANCE_NOT_FOUND` → `HOLD_INSTANCE_UNAVAILABLE` (cancelada) → `HOLD_INSTANCE_PAST` (ya empezó) → `HOLD_BOOKING_CLOSED`. Sin fila en `business_settings` (singleton, no debería pasar) la función lanza `SETTINGS_MISSING`, el precedente de …047: falla cerrada.
- **Calendario**: `getUpcomingInstances` filtra `starts_at > now() + cutoff horas`. Las horas las lee `getBookingCutoffHours()` en `lib/operator/repository.ts`, con el cliente de servicio y `cache()` (la RLS de `business_settings` deja leer solo a admin y staff, no al turista anónimo). Si la lectura falla, se registra y el calendario usa `BOOKING_CUTOFF_HOURS_DEFAULT`; la base sigue siendo la que decide.
- **Checkout**: la página busca la salida aparte. Si existe, es de este tour, está `available` y empieza dentro del corte, muestra el aviso de salida cerrada con enlace al calendario; en los demás casos que no son reservables, 404 como hoy. `HOLD_BOOKING_CLOSED` se traduce a la clave `booking-closed` en los dos checkouts. No va en `RESTART_CHECKOUT_ERRORS`: empezar de nuevo no sirve.
- **Configuración**: el campo va en la sección de horas del formulario actual (`SettingsForm`), con su validación en la action (`SettingsActionError.CutoffOutOfRange`) y en `shared/constants/settings.ts` (`BOOKING_CUTOFF_HOURS_MIN = 0`, `MAX = 72`, `DEFAULT = 3`). El formulario y la action pasan de dos campos a tres: el mensaje de error usa el rango del campo que falló.

## 6. Modelo de datos

Migración `supabase/migrations/20260929000054_anticipacion_minima.sql`:

- **Tabla** `business_settings` — alter: `booking_cutoff_hours integer NOT NULL DEFAULT 3 CHECK (booking_cutoff_hours BETWEEN 0 AND 72)`; `GRANT UPDATE (booking_cutoff_hours) ON public.business_settings TO authenticated` (la RLS de update ya limita al admin).
- **Función** `public.create_hold_atomic(uuid, integer, text)` — `CREATE OR REPLACE` con el control nuevo; mismo `REVOKE` que en …028 y `GRANT` explícito a `service_role`.
- Reversión: recrear `create_hold_atomic` como en …036 y borrar la columna.

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Salida justo en el borde** (empieza exactamente a `now() + corte`): cerrada. Desde afuera no es determinista; los tests prueban a un minuto de cada lado.
- **Corte en 0**: se comporta como hoy (`starts_at <= now()` cerrada).
- **El admin sube el corte con turistas en el checkout**: los que ya tienen un apartado siguen (el control es al crear el apartado); los nuevos se cierran.
- **Salida pasada**: `HOLD_INSTANCE_PAST`, como hoy, con cualquier corte.
- **Calendario abierto mientras pasa la hora de cierre**: el botón sigue visible, y el checkout muestra el aviso de salida cerrada.
- **Salida bajo el mínimo que todavía no se resolvió**: se puede reservar si está fuera del corte; si la reserva hace que alcance el mínimo, la salida sigue.
- **Salida cancelada por el mínimo**: `HOLD_INSTANCE_UNAVAILABLE`, como hoy.
- **Sin fila en `business_settings`** (no debería pasar, es un singleton): la base lanza `SETTINGS_MISSING` y no se vende; el calendario usa el valor por defecto.

## 9. Impacto en otras áreas

- **Panel admin**: un campo en Configuración.
- **Sitio público**: calendario y checkout.
- **Pagos**: sin cambios; el control es previo a crear el pago.
- **Worker, emails, reportes**: sin cambios.
- **i18n**: etiqueta y ayuda del campo, error de rango, aviso de salida cerrada.
- **Tipos**: `web/types/database.ts` se actualiza a mano (no se regenera).
- **Tests existentes**: se revisan las fixtures que crean salidas dentro de las próximas 3 horas y toman apartados (`deferred-*`, `late-payment-refund`, `overbook`); con el valor por defecto dejarían de funcionar.

## 10. Plan de tests

- **Unit**: rango en la action (0 y 72 se aceptan; -1, 73, 2,5 y vacío no); traducción de `HOLD_BOOKING_CLOSED` a `booking-closed` en los dos checkouts.
- **Integración** (con el valor por defecto de 3 horas, sin cambiar el valor global salvo en una suite serial que lo restaura):
  - `create_hold_atomic`: rechaza una salida a now+2h59 y acepta una a now+3h05; una cancelada dentro del corte da `HOLD_INSTANCE_UNAVAILABLE`; una pasada da `HOLD_INSTANCE_PAST`.
  - Con corte 0 (suite serial): acepta una salida a now+10 min.
  - El admin puede guardar el corte; staff no; fuera de rango lo rechaza el `CHECK`.
  - `getUpcomingInstances` no devuelve las salidas dentro del corte.
- **Manual en el PR**: el aviso de salida cerrada en la página del checkout.

## 11. Plan de rollout

- Sin feature flag. Migración con respaldo previo antes de promover a `main`.
- El valor inicial (3 horas) aplica apenas se migra: desde ese momento las salidas de las próximas 3 horas dejan de venderse en línea. Entre la migración y el despliegue (minutos), el código viejo lista esas salidas y el checkout muestra un error genérico; aceptado.
- Reversible con la migración inversa (§6).

## 12. Métricas de éxito

- Cero apartados (`tour_holds.created_at`) creados con menos anticipación que el corte configurado.

## 13. Preguntas abiertas

Ninguna. Decisiones tomadas por defecto que el usuario puede cambiar al aprobar:

- Quien ya empezó a pagar antes del cierre puede terminar.
- Un enlace a una salida cancelada o ya pasada sigue dando 404; el aviso es solo para las disponibles dentro del corte.
- Sin configuración en la base, no se vende (falla cerrada).
