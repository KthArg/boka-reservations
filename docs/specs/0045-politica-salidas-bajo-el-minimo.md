# 0045 — Política de las salidas bajo el mínimo: decide el staff, las vacías se cancelan solas

- **Estado**: approved
- **Autor**: Kenneth (con Claude Code)
- **Creado**: 2026-10-05
- **Última actualización**: 2026-10-05
- **Rama**: dev (push directo a `main`, autorizado por el usuario)
- **PR**: (sin PR)

## 1. Contexto y motivación

Una salida tiene un mínimo de participantes (`tours.min_participants`). Hoy, qué pasa cuando no lo alcanza depende de cómo se cobró:

- **Cobro diferido** (spec 0033, migración …055): al vencer el plazo de cobro (30 horas antes), la salida pasa a la bandeja "Salidas que esperan decisión" y decide el staff. El motor nunca cancela solo.
- **Cobro inmediato** (spec 0035, `resolve_immediate_minimum`): entre 25 y 24 horas antes, el worker cancela sola la salida, con reembolso del 100 %. La misma regla cancela las salidas sin ninguna reserva.

El operador arranca con pocos turistas y va a aceptar varias salidas bajo el mínimo. Quiere una sola regla para los dos cobros: si la salida tiene reservas pero no llega al mínimo, decide una persona; si no tiene ninguna reserva, se cancela sola 24 horas antes. Cuando el negocio esté establecido quiere poder volver a la cancelación automática sin pedir un cambio de código.

Actores: **staff y admin** (deciden en Salidas), **admin** (elige la política en Configuración), **turista** (recibe el aviso de la decisión).

## 2. Objetivos

- Hacer que una salida con reservas y bajo el mínimo espere la decisión del staff en los dos cobros, sin cancelarse sola.
- Cancelar solas, entre 25 y 24 horas antes, las salidas con mínimo que no tienen ninguna reserva, en los dos cobros.
- Permitir que el admin cambie entre "decide el staff" y "se cancelan solas" desde Configuración, sin deploy.

## 3. Fuera de alcance

- No cambia el plazo de 24 horas de aviso para cancelar por mínimo, ni el reembolso del 100 %.
- No cambia el ciclo de cobro del diferido (plazo de 30 horas, autorización, captura, reintentos).
- No cambia qué pasa con una salida del cobro diferido que nadie decide: sus reservas sin cobrar se cancelan a la hora de la salida.
- No se cancelan las salidas vacías de tours sin mínimo (`min_participants <= 1`): siguen a la venta hasta la anticipación mínima (spec 0041).
- No hay política por tour: es una sola, global.
- No se avisa al guía asignado a una salida vacía que se cancela (comportamiento actual).
- No se agregan emails nuevos.

## 4. Historias de usuario

> Como staff, quiero decidir yo si una salida con pocos turistas se hace o se cancela, para no perder ventas mientras el negocio arranca.

> Como admin, quiero elegir desde Configuración si las salidas bajo el mínimo las decide el staff o se cancelan solas, para cambiar de criterio sin depender de un desarrollador.

Definiciones:

- **Salida vacía**: no tiene reservas `confirmed`, `pending_minimum`, `pending_payment` ni `payment_mismatch`, ni apartados vivos (`active` sin vencer o `paying`).
- **Política**: `business_settings.below_minimum_policy`, `staff_decides` (valor inicial) o `auto_cancel`.

Criterios de aceptación:

- [ ] Configuración muestra el campo "Salidas bajo el mínimo" con dos opciones; solo el admin lo cambia. El valor inicial es "Decide el staff".
- [ ] **Vacía, cualquier política**: una salida vacía de un tour con mínimo mayor a 1 se cancela sola cuando faltan entre 25 horas y 24 horas 10 minutos, con motivo `minimum` y resolución `auto_cancelled`. No se envía ningún correo (no hay turistas).
- [ ] **Casi vacía**: si en esa ventana la salida no tiene reservas pero sí un apartado vivo o una reserva `payment_mismatch`, no se cancela en esa corrida; la siguiente (5 minutos después) vuelve a evaluar.
- [ ] **Con reservas, política `staff_decides`, cobro inmediato**: el worker no la cancela. La salida sigue en la bandeja "Salidas bajo el mínimo" hasta que empieza o alguien la resuelve. El staff puede mantenerla en cualquier momento y cancelarla por mínimo hasta 24 horas 10 minutos antes; después, solo por otra causa. Si nadie decide, la salida se hace.
- [ ] **Con reservas, política `staff_decides`, cobro diferido**: igual que hoy (bandeja "Salidas que esperan decisión").
- [ ] **Con reservas, política `auto_cancel`, cobro inmediato**: igual que hoy (se cancela sola entre 25 y 24 horas antes, reembolso del 100 %, correo de salida cancelada).
- [ ] **Con reservas, política `auto_cancel`, cobro diferido**: al vencer el plazo de cobro sin alcanzar el mínimo, el motor cancela la salida (`auto_cancelled`) y los turistas reciben `departure_cancelled_minimum`, solo si se cumple todo esto: faltan 72 horas o menos y más de 24 horas 10 minutos; todas las retenciones quedaron sueltas en esa misma corrida (ningún intent ya cobrado sin asentar, ninguna cancelación fallida en la pasarela); releídos los cupos después de soltar, no hay ninguno cobrado ni autorizado; y la base, bajo el lock de la salida, confirma que la política sigue siendo `auto_cancel`, que todas las reservas vivas están en `pending_minimum` y que ninguna tiene un pago abierto. Si algo no se cumple, decide el staff, como hoy.
- [ ] La bandeja "Salidas bajo el mínimo" no lista salidas vacías. Su texto dice qué va a pasar según la política vigente.
- [ ] La bandeja "Salidas que esperan decisión" no lista salidas sin reservas vivas.
- [ ] Cambiar la política rige desde la corrida siguiente del worker; no toca salidas ya resueltas.

## 5. Diseño técnico

- **Configuración**: columna nueva `business_settings.below_minimum_policy`. Se edita en `/dashboard/settings` con un `<select>`, por la server action `updateBusinessSettings` (admin). Constantes en `shared/constants/settings.ts` (`BelowMinimumPolicy`); el worker repite los dos literales (no importa `@shared` en runtime).
- **Cobro inmediato y salidas vacías**: `resolve_immediate_minimum` se reemplaza (misma firma). Después de las guardas actuales (resuelta, fuera de ventana, `deferred_flow`, mínimo alcanzado):
  1. si no hay reservas vivas: con apartados vivos o `payment_mismatch` devuelve `checkout_in_progress` sin tocar nada; si no, `cancel_departure(…, 'minimum', NULL)`;
  2. si hay reservas y la política es `staff_decides`, devuelve `awaiting_staff` sin tocar nada;
  3. si la política es `auto_cancel`, cancela como hoy.
     La política se lee dentro de la función, bajo el lock de la salida.
- **Cobro diferido**: `decideRelease` recibe la política y suma el resultado `auto_cancel` (política `auto_cancel`, a 72 horas o menos, sin cupos cobrados y con 24 horas o más por delante). `releaseAll` pasa a informar si soltó todo; `releaseDeparture` relee los cupos después de soltar y recién entonces llama a la función nueva `auto_cancel_departure_minimum`, que repite las guardas bajo el lock de la salida y envuelve a `resolve_departure_minimum(…, 'auto_cancelled')`. Las guardas van en la base porque entre que el worker mira y cancela puede entrar un pago: no cancela con una reserva `pending_payment` (un turista del cobro inmediato en el widget, o un cobro diferido o manual en curso), `confirmed` o `payment_mismatch`, ni con un pago `pending` en una reserva viva. El margen es de 24 horas 10 minutos, el mismo de `cancel_departure`: el correo sale al minuto siguiente. El job lee la política una vez por corrida; si no puede leerla, rige `staff_decides`.
- **Salida vacía con un ciclo diferido abierto** (todas sus reservas se cancelaron después de abrir el ciclo): no tiene reservas diferidas vivas, así que la resuelve `resolve_immediate_minimum` como cualquier vacía. El motor no alerta por una salida sin cupos vendidos.
- **Alertas**: con `staff_decides`, la alerta de Sentry "salida bajo el mínimo sin resolver a menos de 24 h: se hace igual" pasa de `error` a `warning` para las salidas con cupos cobrados: ya no indica un worker caído sino una decisión que no se tomó. Para una salida sin cupos cobrados sigue en `error`.
- **Panel**: `minimumView` recibe si la salida tiene reservas vivas y excluye las vacías de la bandeja. `MinimumTray` recibe la política y elige el texto. `DecisionTray` filtra por `liveTickets > 0`.

Alternativa descartada: una constante en el código. Volver a la cancelación automática exigiría un deploy; el usuario quiere cambiarlo solo.

## 6. Modelo de datos

- **Tabla**: `business_settings`
- **Acción**: alter
- **Columnas**: `below_minimum_policy text NOT NULL DEFAULT 'staff_decides'`, CHECK `IN ('staff_decides', 'auto_cancel')`.
- **Grants**: `GRANT UPDATE (below_minimum_policy) … TO authenticated` (la RLS de …043 limita la escritura al admin).
- **Funciones**: `CREATE OR REPLACE` de `resolve_immediate_minimum(uuid)` (conserva dueño, REVOKE y GRANT de …049) y `auto_cancel_departure_minimum(uuid)` nueva, `SECURITY DEFINER`, solo `service_role`.
- **Migración**: `20261005000057_politica_bajo_el_minimo.sql`.

## 7. Estados y transiciones

Sin estados nuevos. Cambia cuándo ocurre `tour_instances.status → cancelled` por mínimo sin actor (`auto_cancelled`):

- antes: toda salida del cobro inmediato bajo el mínimo, entre 25 y 24 horas antes;
- ahora: las vacías siempre; las que tienen reservas solo con la política `auto_cancel` (inmediato: misma ventana; diferido: al vencer el plazo de cobro).

`resolve_immediate_minimum` suma los resultados `awaiting_staff` y `checkout_in_progress`, que no cambian nada.

## 8. Casos borde y errores

- **Reserva que entra durante la ventana**: una vacía con un apartado vivo no se cancela; si el pago se acredita, pasa a ser una salida con reservas y sigue la política.
- **Pago que se acredita después de cancelada la vacía**: `confirm_booking` ve la salida cancelada y reembolsa entero (comportamiento actual de `cancel_departure`).
- **Worker caído durante toda la ventana**: la salida vacía no se cancela; queda a la venta hasta la anticipación mínima. No se cancela con menos de 24 horas.
- **Cambio de política con salidas en curso**: rige en la corrida siguiente. Pasar a `auto_cancel` con una salida inmediata a menos de 24 horas no la cancela (fuera de ventana). Pasar a `auto_cancel` con una salida diferida que ya espera decisión la cancela en la corrida siguiente si todavía faltan 24 horas o más.
- **Salida mixta** (reservas inmediatas y diferidas): la resuelve el motor diferido, como hoy. Con `auto_cancel`, una mixta no se cancela sola mientras tenga un pago inmediato en curso, cobrado o en revisión: decide el staff.
- **Reserva diferida que entra con el plazo de cobro ya vencido** (política `auto_cancel`): el motor ya no autoriza en ese ciclo, así que la salida se cancela en la corrida siguiente y el turista recibe el aviso de salida cancelada. Se acepta: con esa política una salida bajo el mínimo no se hace.
- **Vacía bloqueada toda la ventana**: la ventana dura 50 minutos. Si un apartado vivo o un pago en curso la ocupan todo ese rato y después se abandonan, la salida vacía no se cancela y sigue a la venta hasta la anticipación mínima. Se acepta.
- **`auto_cancel` y el momento del corte**: el diferido cancela al vencer el plazo de cobro (30 horas antes, o antes si el ciclo abrió con mucha anticipación); el inmediato, entre 25 y 24 horas antes. Con `auto_cancel`, el staff no puede salvar una salida diferida después de vencido el plazo.
- **Dos corridas a la vez**: `resolve_immediate_minimum` bloquea la salida con `FOR UPDATE`; la segunda ve `already_resolved`.
- **Fila de configuración ausente**: la función trata la política como `staff_decides` (no cancela reservas por un dato faltante).
- **Staff que nunca decide (inmediato)**: la salida se hace con los turistas que haya. Es el riesgo que el operador acepta al elegir `staff_decides`.

## 9. Impacto en otras áreas

- **Panel**: campo nuevo en Configuración; textos de la bandeja "Salidas bajo el mínimo" según la política; las vacías salen de las dos bandejas.
- **Worker**: `resolve-minimum` (resultados nuevos, nivel de la alerta) y `charge-departures` (rama `auto_cancel`).
- **Emails**: sin plantillas nuevas. Con `staff_decides` deja de salir solo el correo de salida cancelada por mínimo del cobro inmediato.
- **Términos**: la cláusula 7 (versión 2026-09-27) dice "Si una salida no alcanza ese mínimo, la cancelamos y se lo avisamos…". Con `staff_decides` una salida bajo el mínimo puede hacerse igual, lo que el texto no contempla (ya pasaba en el cobro diferido desde …055). El texto legal no se toca en este spec: queda para la revisión de la abogada.
- **Specs anteriores**: reemplaza la regla del 0035 ("toda salida bajo el mínimo se cancela") y reintroduce, como opción global, la cancelación automática que el 0033 §15 había retirado.
- **i18n**: textos nuevos en ES y EN (campo de Configuración, dos textos de bandeja).
- **Reportes y pagos**: sin impacto.

## 10. Plan de tests

- **Unit (worker)**: `decideRelease` con las dos políticas, con y sin cupos cobrados, a más de 72 horas, entre 72 y 24, y a menos de 24.
- **Unit (web)**: `minimumView` excluye las vacías; el esquema del formulario rechaza una política desconocida.
- **Integración (DB)**: `resolve_immediate_minimum` — vacía se cancela; vacía con apartado vivo devuelve `checkout_in_progress`; con reservas y `staff_decides` devuelve `awaiting_staff` y no toca nada; con reservas y `auto_cancel` cancela y reembolsa; vacía con ciclo diferido abierto se cancela; tour con mínimo 1 no se cancela.
- **Integración (worker)**: el motor diferido cancela con `auto_cancel` y espera con `staff_decides`.
- **Integración (web)**: la action guarda la política solo para admin; grants de la columna.
- **Manual en producción**: ver el campo en Configuración y el texto de las bandejas.

## 11. Plan de rollout

- Sin feature flag: la política es el interruptor.
- Orden: respaldo, migración, y después el código. Entre la migración y el deploy del worker, el worker viejo sigue llamando a la función nueva, que ya aplica la política: no hay ventana insegura.
- Efecto inmediato en producción: con el valor inicial `staff_decides`, las salidas del cobro inmediato con reservas dejan de cancelarse solas.
- Reversión: poner la política en `auto_cancel` restaura el comportamiento anterior del cobro inmediato. Para revertir el código: recrear el cuerpo de …049 y `DROP COLUMN`.

## 12. Métricas de éxito

- Cero salidas con reservas canceladas con resolución `auto_cancelled` mientras la política sea `staff_decides` (consulta sobre `audit_logs`: `departure.cancelled` con `refunded_bookings + unpaid_bookings > 0` y sin actor, más `departure.minimum_resolved` con resolución `auto_cancelled`).

## 13. Preguntas abiertas

- [ ] **Pregunta**: ¿se ajusta la cláusula 7 de los términos para decir que una salida bajo el mínimo puede hacerse igual? **Dueño**: Kenneth (con la abogada) **Antes de**: el lanzamiento.
