# 0043 — Aviso en el panel de las salidas con reservas y sin guía

- **Estado**: approved
- **Autor**: Kenneth (con Claude Code)
- **Creado**: 2026-10-03
- **Última actualización**: 2026-10-03
- **Rama**: feat/0043-aviso-salida-sin-guia
- **PR**: (sin asignar)

## 1. Contexto y motivación

El guía se asigna por salida (`tour_instance_guides`, spec 0009; una sola asignación por salida desde el spec 0028). Nada avisa cuando una salida que ya tiene turistas se queda sin guía. Pasó en la prueba de reprogramación del 2026-09-30: al mover una reserva a otra fecha, el guía siguió asignado a la salida vieja, que quedó vacía, y la nueva quedó con un turista y sin guía. El staff solo lo descubre si revisa la tabla de Salidas fila por fila.

Una salida con turistas y sin guía es un tour que nadie va a guiar: el turista se presenta y no hay nadie. Es el peor resultado operativo posible, y es evitable con un aviso visible.

Actores: **staff y admin** (asignan guías desde Salidas).

## 2. Objetivos

- Mostrar arriba del panel de Salidas, en una bandeja propia, las salidas próximas que tienen reservas vivas y ningún guía activo asignado.
- Marcar esas mismas salidas en la tabla, para que se distingan sin abrir la bandeja.
- Permitir asignar el guía desde la propia bandeja, con el mismo selector que la tabla.

## 3. Fuera de alcance

- No se envía email ni otra notificación al staff: el aviso vive en el panel (mismo criterio que el spec 0029).
- No se reasigna el guía automáticamente al reprogramar una reserva ni en ningún otro caso.
- No se avisa de salidas sin reservas: una salida vacía sin guía no es un problema.
- No se cambia el modelo de asignación (un guía por salida).
- No se avisa al guía ni al turista.

## 4. Historias de usuario

> Como staff, quiero ver de un vistazo qué salidas próximas tienen turistas y no tienen guía, para asignarlo antes de que el tour empiece.

Criterios de aceptación:

- [ ] Una salida aparece en la bandeja "Salidas sin guía" si: `now < starts_at < now + 14 días` (tiempo transcurrido, no días calendario), no está cancelada, tiene al menos una reserva viva y no tiene un guía activo asignado.
- [ ] Reserva viva = `confirmed`, `pending_minimum` o `pending_payment`. Cuenta también una `pending_payment` con una cancelación del turista en curso (`cancel_claimed_at`): hasta que se cierre, el turista podría presentarse.
- [ ] Un guía asignado pero desactivado (spec 0010) cuenta como "sin guía".
- [ ] La bandeja ordena las salidas por fecha de inicio, la más cercana primero, y muestra fecha y hora, tour, "cupos (incluye pendientes)" y el selector de guía.
- [ ] Las salidas con `starts_at - now < 24 h` (estricto) se marcan como urgentes dentro de la bandeja.
- [ ] La bandeja muestra como mucho 30 salidas; si hay más, agrega "y N más en la tabla".
- [ ] Al asignar un guía desde la bandeja, la salida sale de ella sin recargar a mano (la acción revalida la página). El guía recibe el email de asignación si es la primera vez que se lo asigna a esa salida (comportamiento actual del spec 0009).
- [ ] En la tabla de Salidas, la celda del guía de esas salidas muestra la marca "Sin guía" en color de alerta.
- [ ] Si no hay ninguna salida en esa situación, la bandeja no se muestra.
- [ ] La bandeja es la primera de la página, arriba de Reembolsos y Revisión: una salida sin guía es lo que más rápido se vuelve irreversible.

## 5. Diseño técnico

- **Datos**: `listUpcomingDepartures` (`web/lib/guides/repository.ts`) ya trae, por salida, sus reservas con su `status` y su guía asignado, y ya excluye las canceladas (`.neq('status', 'cancelled')`). Cambios:
  - el embed del guía suma `active`: `users!guide_id ( id, full_name, active )` (la columna es legible para `authenticated`, …038);
  - `Departure` suma `liveTickets` (participantes de reservas vivas) y la marca de si el guía asignado está activo.
- **Regla**: función pura `needsGuide(departure, now)` en `web/lib/guides/`, que mira `liveTickets`, `starts_at` y el guía activo. Las canceladas no le llegan.
- **Constantes** en `shared/constants/`: `GUIDE_WARNING_HORIZON_DAYS = 14`, `GUIDE_WARNING_URGENT_HOURS = 24`, `GUIDE_WARNING_TRAY_LIMIT = 30`. Solo las usa la web.
- **Bandeja**: componente `GuidelessTray` en `web/app/[locale]/(admin)/dashboard/departures/`, junto a las bandejas existentes. Reusa `GuideAssigner` y la server action `assignGuide` del spec 0009.
- **Marca en la tabla**: la celda del guía muestra "Sin guía" con el estilo de alerta del sistema de diseño (spec 0042) cuando `needsGuide` es verdadero.
- **Permisos**: los de la página (admin y staff).

## 6. Modelo de datos

Sin cambios al modelo de datos.

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Reserva reprogramada**: la salida de destino gana una reserva viva; si no tiene guía, aparece en la bandeja. La de origen, si queda vacía, deja de contar.
- **Guía desactivado**: aparece como "sin guía". El selector, que solo lista guías activos, muestra "Seleccionar guía" porque el asignado no está entre las opciones; asignar otro reemplaza la asignación.
- **Salida cancelada con reservas en revisión** (spec 0035): no aparece; `listUpcomingDepartures` no la devuelve.
- **Dos personas asignan a la vez**: el índice único `tour_instance_guides_one_guide_per_instance` (spec 0028, …041) y el upsert de `assignGuide` dejan una sola asignación; la segunda reemplaza a la primera, como hoy.
- **Mismo guía reasignado**: no recibe un segundo email (el encolado es idempotente por salida y guía).
- **Checkout abandonado** (`pending_payment` del cobro inmediato): puede hacer aparecer una salida en la bandeja hasta que la limpie el reconciliador (`cancel_stale_pending_booking`, 30 minutos). Se acepta: es un falso positivo breve y del lado seguro.

## 9. Impacto en otras áreas

- **Panel**: bandeja nueva y marca en la tabla de Salidas.
- **i18n**: textos nuevos en ES y EN (título, introducción, "Sin guía", "Urgente", "cupos (incluye pendientes)", "y N más en la tabla").
- **Emails, worker, reportes, pagos**: sin impacto.

## 10. Plan de tests

- **Unit** (`needsGuide`): con reservas vivas y sin ellas; con guía activo, inactivo y sin guía; en el límite de los 14 días; urgente justo por debajo de 24 h y no urgente en 24 h exactas.
- **Integración**: `listUpcomingDepartures` devuelve `liveTickets` correcto con reservas `confirmed`, `pending_minimum`, `pending_payment` reclamada y `cancelled` mezcladas; una salida cancelada con reservas no se devuelve; un guía asignado y después desactivado deja la salida en la bandeja; asignar un guía la saca; con 31 salidas la bandeja muestra 30 y "y 1 más en la tabla".
- **Manual (en el PR)**: reprogramar una reserva a una salida sin guía y verla aparecer; asignar desde la bandeja.

## 11. Plan de rollout

- Sin feature flag: es solo lectura más un selector que ya existe.
- Sin migración de datos.
- Reversible quitando el componente.

## 12. Métricas de éxito

- Cero salidas realizadas con turistas y sin guía. Consulta de cierre de cada mes: salidas con `starts_at` en el mes, al menos una reserva `confirmed` y sin fila en `tour_instance_guides`. Quitar una asignación después de la salida falsea la medición; no está previsto en la operación.

## 13. Preguntas abiertas

- [ ] **Pregunta**: ¿14 días es la ventana correcta, o el operador asigna guías con más anticipación? **Dueño**: Kenneth (con el cliente) **Antes de**: 2026-10-10.
