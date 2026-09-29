# Changelog — 0040 Temporadas de precio que se repiten cada año

## 2026-09-29 — Implementación completa

**Hecho**:

- Migración 052 (paso 1): `season_start`/`season_end` (`MM-DD`), conversión de las temporadas con año (vencidas → inactivas con `NOTICE`, un año o más → todo el año, choques → la vigente o la que empieza antes), fuera el `EXCLUDE` con `daterange`, índice del precio base sobre `season_start`, y constraint trigger diferido `tour_pricing_season_overlap` (23P01) con advisory lock por tour. `valid_*` quedan hasta la 053.
- `lib/pricing/season.ts`: `inSeason`, `seasonsOverlap`, `selectPriceForDay`, `lowestChargedPrice`, con cruce de año y 29/02.
- Cobro (`checkout-pricing.ts`) y pantalla del checkout (`getTourPricingForDay`) eligen el precio con el día de la salida en Costa Rica. El checkout inmediato compara el total que vio el turista con el que se cobra (`CHECKOUT_AMOUNT_CHANGED`), como ya hacía el diferido.
- Cantidades iniciales según los tiquetes con precio ese día; un día sin precios no se vende; totales en centavos enteros por tiquete.
- Editor: precio base o temporada con selectores de día y mes (`SeasonFields`, `MonthDayField`); cada fila con problema dice cuál y con qué temporada choca; el formulario no se envía con errores de tarifas.
- Sitio: lista de precios con las temporadas y sus fechas; el calendario muestra el precio de adulto del día; "desde" es el precio de adulto más bajo que se cobra.
- `seed.sql` y los tests de precios pasan a día-mes.

**Decisiones**:

- Revisiones: db-schema-guardian (sin bloqueantes; se sumó el registro de vencidas, la regla de no editar precios entre la migración y el despliegue, y la reversión detallada), code-reviewer (sin bloqueantes; validación antes de enviar y aviso que nombra la otra temporada) y payment-flow-auditor (sin riesgos críticos; se sumaron la comparación del total en el checkout inmediato, las cantidades iniciales y el día sin precios).
- Producción al 2026-09-29: el tour "hola" solo tiene precios de septiembre (sin base); desde el 1 de octubre no tiene precio. Hay que cargarle un precio base.

**Tests**:

- Unit: `season.test.ts`, `calendar-departures` (precio del día, borde 00:30 CR), `pricing-math` (centavos, cantidades iniciales), `initCheckout` con total distinto, validaciones día-mes.
- Integración: trigger (borde compartido, cruce de año, 29/02, contiguas, otro tiquete, reactivar una que choca, base duplicado), correr el borde en un solo guardado, mapeo del error, cobro por día de la salida (y no por hoy), pantalla igual al cobro.

**Pendiente**:

- Migración 053 (borrar `valid_from`/`valid_until`) después del despliegue verificado.
- Test del diferido de punta a punta (paso 1 = paso 2 en temporada alta) y de dos guardados concurrentes.
