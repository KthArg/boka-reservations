# 0039 — Calendario de fechas en la página del tour

- **Estado**: approved
- **Autor**: Claude (con pedido del usuario del 2026-09-29)
- **Creado**: 2026-09-29
- **Última actualización**: 2026-09-29
- **Rama**: feat/0039-calendario-de-fechas
- **PR**: (cuando aplique)

Revisado por spec-reviewer el 2026-09-29; los hallazgos están resueltos en este texto.

## 1. Contexto y motivación

La página pública de cada tour muestra las salidas como una lista plana agrupada por mes, con un botón "Reservar" por fila. Con un tour que sale tres días por semana, la lista ya tiene 38 filas para tres meses. En la primera prueba real (2026-09-29) se vieron estos problemas:

- Para encontrar un día puntual hay que recorrer toda la lista, lo que en el celular es incómodo.
- No se ve cuántos lugares quedan en cada salida.
- Los títulos de mes salen como "Septiembre De 2026" (el formato de fecha de `es-CR` más una capitalización de cada palabra).

El usuario eligió reemplazar la lista por un calendario mensual, el formato que el turista ya conoce de otros sitios de reservas.

## 2. Objetivos

- Permitir que el turista encuentre y elija una fecha de salida con un calendario mensual, en el celular y en la computadora.
- Mostrar, para el día elegido, cada horario con los lugares disponibles y su acceso al checkout.
- Mostrar los meses y las fechas con un formato correcto en español y en inglés.

## 3. Fuera de alcance

- No cambia qué salidas se ofrecen: siguen siendo las `available` que todavía no empezaron. En particular, no se agrega una anticipación mínima para reservar (hoy se puede reservar hasta la hora de salida); es una decisión de negocio aparte.
- No cambia el checkout ni su URL (`/<locale>/tours/<slug>/checkout?instance=<id>`).
- No se muestra el precio por fecha en el calendario: la sección "Precios" de la página sigue mostrando los precios vigentes.
- No se muestran las salidas canceladas (la consulta ya las excluye).
- El número de lugares no descuenta las reservas del cobro diferido que esperan el mínimo (spec 0029), que ocupan cupo con un apartado en `paying` durante días. El cobro diferido está apagado para el lanzamiento, y con cobro inmediato un apartado dura minutos. Si se enciende, hay que revisar este número (queda anotado en el checklist de lanzamiento).
- No se agrega un calendario en el panel admin ni uno que junte varios tours.
- No se agrega navegación con flechas del teclado dentro de la grilla; se navega con Tab y Enter.
- Sin cambios en la base ni en las consultas.

## 4. Historias de usuario

> Como turista, quiero ver en un calendario qué días sale el tour, para elegir la fecha que me sirve sin recorrer una lista larga.

- [ ] El calendario muestra un mes a la vez, con la semana de lunes a domingo, en los dos idiomas.
- [ ] Los días con al menos una salida con lugares se ven resaltados y son botones. Los días donde todas las salidas están llenas se ven marcados como "Agotado" y no se pueden elegir. Los días sin salidas son texto apagado, sin parada de Tab.
- [ ] El día de hoy (en Costa Rica) tiene una marca discreta.
- [ ] Al cargar la página, el calendario abre en el mes de la primera salida con lugares, con ese día ya elegido.
- [ ] Al cambiar de mes, queda elegido el primer día con lugares de ese mes. Si el mes no tiene ninguno, no queda ningún día elegido y se lee "No hay salidas este mes".
- [ ] Las flechas cambian de mes. La anterior se desactiva en el mes de la primera salida y la siguiente en el mes de la última.
- [ ] El título del mes dice "Octubre 2026" en español y "October 2026" en inglés.

> Como turista, quiero ver los horarios del día que elegí y cuántos lugares quedan, para reservar con confianza.

- [ ] Debajo del calendario aparece la fecha elegida en formato largo ("martes 6 de octubre" / "Tuesday, October 6").
- [ ] Por cada salida de ese día se ve la hora, los lugares disponibles ("Quedan 7 lugares" / "7 spots left"; en singular con 1) y el botón "Reservar", que lleva al checkout de esa salida.
- [ ] Una salida llena del día elegido se lista con "Agotado" y sin botón.
- [ ] Con 3 lugares o menos (constante `LOW_SEATS_THRESHOLD`), el texto dice "¡Últimos 3 lugares!" / "Only 3 spots left!" y se destaca: el aviso está en el texto, no solo en el color.
- [ ] Los días y las horas son los de Costa Rica, sin importar la zona horaria del navegador: una salida a las 23:30 de Costa Rica aparece en ese día.

> Como turista con un lector de pantalla, quiero poder usar el calendario.

- [ ] Cada día con salida es un botón con la fecha completa como nombre accesible y `aria-pressed` cuando está elegido.
- [ ] Las flechas de mes tienen nombre accesible ("Mes anterior" / "Previous month") y quedan `disabled` en los extremos.
- [ ] El título del mes y la lista del día están en regiones `aria-live="polite"`: cambiar de mes o de día se anuncia.
- [ ] Los encabezados cortos de los días de la semana tienen el nombre completo accesible.

## 5. Diseño técnico

- `AvailabilityCalendar` pasa a ser un componente cliente con dos estados: el mes que se ve y el día elegido. La página del tour lo sigue renderizando desde el servidor, así que el primer render llega con el calendario armado y el primer día elegido.
- **Datos mínimos al navegador**: la página mapea en el servidor cada salida de `getUpcomingInstances` a `{ id, crDay, time, seatsLeft }` (la hora ya formateada) y le pasa al componente esa lista más `today` (`crDate()` calculado una vez en el servidor). No viaja la fila completa de `tour_instances`.
- **Sin diferencias entre servidor y navegador** (hydration): los nombres de los días de la semana y de los meses salen de los archivos de idioma, no de `Intl`, porque el texto de `Intl` cambia entre Node y cada navegador ("mar" o "mar."). Las horas se formatean en el servidor y viajan como texto. "Hoy" viene del servidor.
- División en archivos, para respetar el límite de 150 líneas: `AvailabilityCalendar.tsx` (estado y navegación), `MonthGrid.tsx` (grilla), `DayDepartures.tsx` (lista del día) y `calendar.ts` (lógica pura).
- La lógica vive en funciones puras, en `components/public/AvailabilityCalendar/calendar.ts`, para probarlas sin navegador:
  - `groupByCrDay(departures)`: agrupa por fecha de Costa Rica y ordena por hora.
  - `buildMonthGrid(year, month)`: las semanas del mes, de lunes a domingo, con celdas vacías al principio y al final. Calcula con `Date.UTC` y `getUTCDay`, para no depender de la zona horaria de quien lo ejecuta.
  - `seatsLeft(instance)`: `capacity_total − capacity_reserved`, nunca menor que 0. Nada en el sistema pasa una salida a `full`, así que las llenas llegan como `available` con 0 lugares y las maneja el calendario. El checkout vuelve a verificar el cupo al apartar.
  - `monthsRange(departures)`: el primer y el último mes con al menos una salida con lugares, para las flechas.
  - `firstBookableDay(days, month?)`: el primer día con lugares, global o de un mes.
- El título del mes se arma con el nombre del mes de los archivos de idioma y el año: "Octubre 2026", sin el "de" de `es-CR`.
- Estilos en el módulo CSS existente. En el celular la grilla ocupa todo el ancho, con celdas de al menos 40 px de alto para el dedo.

## 6. Modelo de datos

Sin cambios al modelo de datos.

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Sin salidas, o todas llenas**: se muestra el texto actual "no hay fechas disponibles" (`detail-no-instances`) y no se muestra el calendario.
- **Una sola salida**: el calendario abre en ese mes con ese día elegido; las dos flechas quedan desactivadas.
- **Meses sin salidas entre dos meses con salidas**: se pueden recorrer; se ven con todos los días apagados.
- **Varias salidas el mismo día**: se listan todas, ordenadas por hora.
- **La salida empieza mientras la página está abierta**: el botón sigue visible y el checkout la rechaza como hoy (`HOLD_INSTANCE_PAST`).
- **La salida se llena mientras la página está abierta**: el checkout la rechaza con `HOLD_NO_CAPACITY` y muestra el aviso de sin disponibilidad, como hoy.
- **Navegador en otra zona horaria** (un turista que planifica desde Europa): los días y las horas siguen siendo los de Costa Rica.
- **La página se abre cerca de la medianoche de Costa Rica**: "hoy" es el del servidor al generar la página; no hay diferencia entre el servidor y el navegador.
- **Navegador sin JavaScript**: se ve el mes inicial con el primer día elegido y sus botones de reserva; las flechas y los otros días no responden. Se acepta: el sitio ya depende de JavaScript para pagar.

## 9. Impacto en otras áreas

- **Panel admin**: sin cambios.
- **Emails**: sin cambios.
- **i18n**: claves nuevas en `public`: `calendar-prev-month`, `calendar-next-month`, `calendar-seats-left` y `calendar-seats-low` (plural ICU `{count, plural, one {…} other {…}}`), `calendar-sold-out`, `calendar-no-departures-month`, `calendar-today`, y los nombres de meses y días de la semana (cortos y largos). Se mantienen `detail-no-instances` y `detail-book-cta`.
- **CSP**: sin cambios. El componente cliente se carga en el bundle de Next, que la CSP ya admite.
- **Checklist de lanzamiento**: se anota que, si se enciende el cobro diferido, el número de lugares del calendario no descuenta las reservas que esperan el mínimo.
- **Pagos, reservas, worker**: sin cambios.

## 10. Plan de tests

- **Unit**:
  - `groupByCrDay`: una salida a las 23:30 de Costa Rica (05:30 UTC del día siguiente) cae en su día; la del 31 de octubre a las 23:30 queda en octubre también en `monthsRange`; varias el mismo día quedan ordenadas por hora.
  - `buildMonthGrid`: septiembre de 2026 empieza en martes (una celda vacía al principio); mayo de 2026 termina en domingo (sin celdas al final). Los tests fijan `TZ=Asia/Tokyo` para probar que no dependen de la zona de la máquina.
  - `seatsLeft`: nunca negativo.
  - `monthsRange`: con una sola salida, el mismo mes al principio y al final.
  - Salidas llenas: un día con una llena y una con lugares queda elegible; un día con todas llenas no; `monthsRange` y `firstBookableDay` las ignoran; todas llenas equivale a sin salidas.
  - `firstBookableDay` por mes: devuelve el primero con lugares o nada.
- **Manual en el PR**: en la página de un tour de producción, en celular y en computadora, en español y en inglés: cambiar de mes, elegir un día, reservar desde el calendario y llegar al checkout de esa salida. Con el navegador en otra zona horaria (DevTools → Sensors), la fecha del calendario coincide con la del checkout. Con un lector de pantalla: nombres de los días, `aria-pressed`, flechas desactivadas y anuncios al cambiar de mes y de día (los tests del web no tienen entorno de DOM).

## 11. Plan de rollout

- Sin feature flag ni migración.
- Reversible: volver a la versión anterior del componente.

## 12. Métricas de éxito

- En la prueba manual, llegar al checkout de una salida elegida toma dos toques desde la página del tour (día y "Reservar").
- Cero diferencias entre la fecha del calendario y la del checkout en la prueba manual con el navegador en otra zona horaria.

## 13. Preguntas abiertas

Ninguna.
