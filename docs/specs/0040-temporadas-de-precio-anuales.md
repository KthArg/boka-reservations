# 0040 — Temporadas de precio que se repiten cada año

- **Estado**: approved
- **Autor**: Claude (con decisiones del usuario del 2026-09-29)
- **Creado**: 2026-09-29
- **Última actualización**: 2026-09-29
- **Rama**: feat/0040-temporadas-anuales
- **PR**: (cuando aplique)

Revisado por spec-reviewer el 2026-09-29; los hallazgos están resueltos en este texto.

## 1. Contexto y motivación

Hoy cada tarifa de un tour tiene un precio base (sin fechas) y, opcionalmente, temporadas con fecha de inicio y fin **con año** (por ejemplo, del 1 al 30 de septiembre de 2026). Eso tiene dos problemas:

1. **Hay que volver a cargar las temporadas todos los años.** El operador piensa en temporadas que se repiten ("alta: de mediados de diciembre a fines de abril"), no en fechas con año. Lo natural es cargar la temporada una vez y, cuando cambia el precio, editar el monto.
2. **El precio se elige por la fecha de compra, no por la del tour.** El checkout, su pantalla y la página pública toman la temporada vigente **hoy**. Un turista que en septiembre reserva una salida del 20 de diciembre paga el precio de septiembre. En turismo, la temporada depende del día del tour.

El usuario decidió (2026-09-29): el precio se elige por la **fecha de la salida**; las temporadas son **rangos día-mes que se repiten cada año** (pueden cruzar el fin de año); las fechas especiales que cambian cada año (Semana Santa) quedan **fuera por ahora**.

## 2. Objetivos

- Permitir que el admin defina temporadas con día y mes, sin año, que se apliquen todos los años sin volver a cargarlas.
- Cobrar, para cada salida, el precio de la temporada en que cae la fecha del tour, o el precio base si no cae en ninguna.
- Mostrar al turista exactamente ese precio: en el calendario, en la pantalla del checkout y en lo que se cobra.

## 3. Fuera de alcance

- Excepciones por fecha exacta con año (Semana Santa, feriados móviles). Si un año necesita otro precio, se ajusta el monto a mano.
- Precios en colones o por moneda: sigue siendo USD.
- Descuentos, cupones, precios por grupo o por canal.
- Cambiar el precio de reservas ya hechas: el monto de una reserva queda fijo al pagar, como hoy.
- Historial de precios.
- Nombre de temporada traducido: `season_label` es un solo texto y se muestra igual en los dos idiomas (supuesto aceptado).
- Los horarios (`tour_schedules.valid_from/valid_until`) no cambian: siguen con fecha y año.

## 4. Historias de usuario

> Como admin, quiero cargar las temporadas una sola vez con día y mes, para no tener que volver a poner fechas cada año.

- [ ] Cada tarifa tiene tipo de tiquete, precio, y opcionalmente una temporada: nombre, día y mes de inicio, día y mes de fin. Sin temporada es el precio base.
- [ ] El inicio y el fin se eligen con un selector de día y otro de mes; no se pide año.
- [ ] Una temporada puede cruzar el fin de año (15 de diciembre al 30 de abril). Una con inicio y fin iguales abarca ese solo día.
- [ ] Si dos temporadas activas del mismo tiquete comparten algún día del año, el formulario no se guarda y dice qué temporadas chocan (tiquete y nombres).
- [ ] Correr el borde entre dos temporadas en un solo guardado (alta hasta el 15/05 y baja desde el 16/05) funciona.
- [ ] Cada tiquete tiene como máximo un precio base activo (como hoy).
- [ ] Un día que no existe (31 de abril) no se puede elegir; el 29 de febrero sí.
- [ ] Cambiar el precio de una temporada es editar el monto; la temporada sigue igual.

> Como turista, quiero ver y pagar el precio que corresponde al día de mi tour.

- [ ] El checkout cobra, por cada tiquete, el precio de la temporada en que cae el día de la salida (en Costa Rica); si no cae en ninguna, el precio base.
- [ ] La pantalla del checkout (tiquetes ofrecidos, precio de cada uno, total con IVA) usa esos mismos precios del día de la salida: lo que se ve es lo que se cobra, en el checkout inmediato y en el diferido.
- [ ] Un tiquete sin precio para el día de la salida no se ofrece para esa salida.
- [ ] En el calendario del tour, cada horario del día elegido muestra el precio de adulto de ese día ("Adulto $65"). Si ese día no tiene precio de adulto, no se muestra precio.
- [ ] La sección "Precios" de la página muestra el precio base y cada temporada con sus fechas ("Temporada alta · 15 dic – 30 abr · $65").
- [ ] El listado de tours muestra "desde $X" con el precio de adulto más bajo que efectivamente se cobra en algún día del año (§5.3).

## 5. Diseño técnico

### 5.1 Modelo

- `tour_pricing` gana `season_start` y `season_end` (texto `MM-DD`), las dos nulas para el precio base o las dos con valor para una temporada. `season_label` sigue siendo obligatorio con temporada. `valid_from` y `valid_until` se borran en un segundo paso (§11).
- Un día `D` (fecha de Costa Rica) cae en `[inicio, fin]` si, con `md = MM-DD de D`: con `inicio <= fin`, `inicio <= md <= fin`; con `inicio > fin` (cruza el año), `md >= inicio` o `md <= fin`. La comparación de texto `MM-DD` respeta el orden del calendario. En años no bisiestos el 29/02 no existe; el 01/03 no cae en una temporada que termina el 29/02.
- Con un día en una temporada y un precio base, gana la temporada (regla del spec 0028). Sin superposición, un día cae como máximo en una temporada por tiquete.

### 5.2 Superposición

- La restricción `EXCLUDE` actual (con `daterange`) no sirve para rangos que se repiten y se borra.
- La reemplaza un **constraint trigger** `tour_pricing_season_overlap`: `AFTER INSERT OR UPDATE ... DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`. Se evalúa al confirmar la transacción, sobre el **estado final** del tour: así un guardado que corre el borde entre dos temporadas no choca con la versión vieja de la otra fila.
- La función `public.tour_pricing_check_season_overlap()`: `SECURITY DEFINER` (no depende de la RLS de lectura de quien guarda), `search_path = ''`, `VOLATILE`. Toma `pg_advisory_xact_lock(hashtext('tour_pricing:' || NEW.tour_id))` para serializar dos guardados del mismo tour y, en `READ COMMITTED`, ve lo que el otro confirmó. Compara las temporadas activas del mismo tour y tiquete, **excluyendo `id = NEW.id`**, e ignora las inactivas y los precios base. Cada temporada se lleva a uno o dos intervalos de día del año en un año bisiesto de referencia (la que cruza el año se parte en dos).
- Si choca: `RAISE EXCEPTION 'tour_pricing_season_overlap' USING ERRCODE = '23P01'`. `writeErrorCode` (`lib/tours/reconcile.ts`) y el insert de `createTour` (`lib/tours/actions.ts`) reconocen `23P01` con ese texto y devuelven `TourActionError.PricingOverlap`.
- La server action valida lo mismo antes de escribir (`detectPricingOverlaps` reescrita para día-mes) y devuelve qué filas chocan; el formulario lo valida antes de enviar. El trigger es la última capa.

### 5.3 Selección del precio

- `lib/pricing/active-filter.ts` pasa a `selectPriceForDay(rows, crDay)`: por tiquete, entre las filas activas, la temporada que contiene el día o, si no hay, el base. Función pura, única, compartida.
- **Cobro** (`resolveAuthoritativeCharge`, usado por los dos checkouts): lee `starts_at` de la salida, calcula su día de Costa Rica y elige el precio con esa fecha. Deja de usar "hoy".
- **Pantalla del checkout**: `lib/public/tours.ts` separa `getTourPriceList(tourId)` (base y temporadas activas, para la página del tour) de `getTourPricingForDay(tourId, crDay)` (precio efectivo de un día, con `selectPriceForDay`). La página del checkout llama a la segunda con el día de la salida y le pasa esos precios a `CheckoutForm`, `DeferredCheckoutForm` (tiquetes ofrecidos, total, IVA) y a `isTourBookable`. Así el paso 1 del diferido muestra el mismo total que valida el paso 2.
- **Calendario**: `toCalendarDepartures` suma a cada salida el precio de adulto de su día (`adultPriceCents | null`), calculado en el servidor con `selectPriceForDay`.
- **"Desde"** del listado: el mínimo de adulto entre las temporadas activas y el precio base; el base se excluye si las temporadas activas de adulto cubren los 366 días (nunca se cobraría). Así no se anuncia un precio que no se puede pagar.

### 5.4 Formulario

- `PricingEditor`: cada fila elige "Precio base" o "Temporada". Con temporada: nombre, y dos pares de selectores día + mes (el selector de día solo ofrece los días válidos del mes elegido). Sin campos de fecha con año.
- Validaciones en el cliente y en la server action: las dos puntas o ninguna, días válidos, nombre con temporada, un solo base activo por tiquete, superposición con el detalle de qué choca.
- `hasHalfOpenSeasons`, `hasInvalidSeasonRange` y `TourActionError.SeasonRangeInvalid` se adaptan a día-mes (un rango día-mes siempre es válido si sus puntas lo son; `SeasonRangeInvalid` pasa a significar "día inexistente").

### 5.5 Datos existentes

La migración convierte cada temporada actual, en este orden, antes de crear el trigger:

1. **Vencida** (`valid_until < hoy` en Costa Rica): queda inactiva.
2. **Un año o más** (`valid_until >= valid_from + 1 año − 1 día`): se convierte a `01-01`–`12-31` (un rango así cubre todos los días del año).
3. **Resto**: `season_start = MM-DD(valid_from)`, `season_end = MM-DD(valid_until)`.
4. **Choques tras la conversión** (por ejemplo, la alta de 2026 y la de 2027 dan el mismo día-mes): por tour y tiquete, queda activa la temporada vigente hoy o, si ninguna lo está, la que empieza antes; las demás quedan inactivas.

Las filas que quedan inactivas no se borran: el admin las ve en el editor y decide. En producción hoy solo están las dos tarifas de prueba del tour "hola" (septiembre y octubre de 2026): septiembre queda activa hasta el 30/09 (vigente), octubre se convierte.

## 6. Modelo de datos

**Migración `supabase/migrations/20260929000052_temporadas_anuales.sql`** (paso 1, compatible con el código viejo):

- **Tabla** `tour_pricing` — alter:
  - `season_start text NULL`, `season_end text NULL`, con `CHECK` de formato `^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$`, `CHECK` de día válido para el mes (febrero hasta 29; abril, junio, septiembre y noviembre hasta 30) y `CHECK` de las dos nulas o las dos con valor (con valor, `season_label` no nula).
  - Conversión de datos según §5.5.
  - Se borran el `EXCLUDE` `tour_pricing_no_seasonal_overlap` y el índice `tour_pricing_one_base_per_type`; se crea `tour_pricing_one_base_per_type` con `WHERE active AND season_start IS NULL`. `valid_from`, `valid_until` y sus `CHECK` quedan hasta el paso 2 (el código nuevo los deja en null).
- **Función** `public.tour_pricing_check_season_overlap()` y **constraint trigger** `tour_pricing_season_overlap` (§5.2), creados después de la conversión.

**Migración `supabase/migrations/20260929000053_temporadas_anuales_limpieza.sql`** (paso 2, después del despliegue): borra `valid_from`, `valid_until`, `valid_season_range` y `season_label_required_with_dates`.

`web/types/database.ts` se actualiza a mano. Reversión anotada en cada migración: la del paso 1 recrea el `EXCLUDE` y el índice viejo, borra el trigger y las columnas nuevas (las columnas viejas siguen ahí); la del paso 2 no se revierte sin datos (las fechas con año se pierden por diseño).

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Temporada que cruza el año** (15/12–30/04): una salida del 3 de enero y una del 20 de diciembre caen en ella; una del 1 de mayo no.
- **Temporadas contiguas** (alta hasta 30/04, baja desde 01/05): válidas.
- **Un solo día** (01/01–01/01): abarca solo el 1 de enero. **Todo el año** (01/01–31/12): válido; el base de ese tiquete no se usa y no cuenta para "desde".
- **Salida al borde del día** (00:30 del 1 de mayo en Costa Rica, 06:30 UTC): se usa el día de Costa Rica.
- **Sin precio para el día**: el tiquete no se ofrece; si ningún tiquete tiene precio, `isTourBookable` da falso para esa salida y el checkout no la vende.
- **Tour sin tiquete de adulto**: el calendario no muestra precio; la lista de precios muestra los demás.
- **Dos guardados del mismo tour a la vez**: el lock los serializa; el segundo ve lo que confirmó el primero.
- **Apartado en curso durante el despliegue**: el paso 1 del diferido con el precio viejo y el paso 2 con el nuevo terminan en `AmountChanged` y el turista vuelve a empezar. Aceptado (ventana de minutos, sin reservas reales hoy).
- **Reservas ya pagadas**: no cambian.

## 9. Impacto en otras áreas

- **Panel admin**: editor de precios (`PricingEditor`, `TourForm`), validaciones (`lib/tours/validation.ts`, `types.ts`, `map.ts`, `reconcile.ts`, `actions.ts`), `shared/schemas.ts` (`TourPricingSchema`).
- **Sitio público**: lista de precios (`PriceList`), calendario (precio del día), listado ("desde"), página del checkout y sus formularios.
- **Cobro**: `checkout-pricing.ts` por fecha de salida. Sin cambios en OnvoPay.
- **Datos de prueba**: `supabase/seed.sql` (precios de Chompipe y La Selva a día-mes) y los fixtures de integración que insertan `valid_from` (`bookings-admin`, `bookings-repository`, `cancellation-fixtures`, `checkin-action`, `db.test`).
- **Emails, worker, reportes**: sin cambios (usan el monto guardado en la reserva).
- **i18n**: editor (base/temporada, día, mes, error de superposición con detalle) y lista de precios.

## 10. Plan de tests

- **Unit**:
  - `selectPriceForDay`: dentro, fuera, bordes, cruce de año (dic, ene, abr, may), 29/02, un solo día, todo el año, base sin temporada, sin precio.
  - Superposición (cliente y server action): sin choque, contiguas, choque simple, con una que cruza el año, dos que cruzan el año, inactivas y otro tiquete no cuentan, detalle de qué choca.
  - Días válidos por mes. "Desde" con y sin cobertura de todo el año.
- **Integración**:
  - Trigger: rechaza una superposición (también con una que cruza el año y 02-29 contra 02-28..03-01), acepta contiguas y otro tiquete, rechaza activar una fila inactiva que choca, acepta correr el borde entre dos temporadas en un solo guardado.
  - Cobro: una salida de temporada alta reservada fuera de temporada cobra el precio alto, en el checkout inmediato y en el diferido (el total del paso 1 es igual al del paso 2).
  - La pantalla del checkout recibe los precios del día de la salida.
  - Migración: vencida → inactiva; más de un año → todo el año o inactiva; dos años iguales → una activa; una que cruza el año se convierte bien.
- **Manual**: cargar base + alta (15/12–30/04) en un tour, ver el precio en el calendario en enero y en mayo, reservar y comparar pantalla y cobro.

## 11. Plan de rollout

- Sin feature flag. Dos pasos para que la venta no quede caída:
  1. Respaldo de producción; migración 052 (el código viejo sigue funcionando: `valid_*` siguen ahí con los datos). Las temporadas que la conversión deja inactivas quedan en los `NOTICE` de la migración.
  2. Promover el código nuevo a `main`. **Entre el paso 1 y el 2 no se editan precios**: el código viejo escribe `valid_*` y no `season_*`. Después del despliegue, esta consulta tiene que dar 0 filas: `SELECT id FROM tour_pricing WHERE valid_from IS NOT NULL AND (season_start IS NULL OR (season_start <> to_char(valid_from,'MM-DD') AND season_start <> '01-01'))`.
  3. Migración 053 (borra las columnas viejas) cuando el despliegue esté verificado.
- Reversible hasta el paso 3 (§6).

## 12. Métricas de éxito

- En la prueba manual, una salida de temporada alta reservada fuera de temporada cobra el precio alto y la pantalla muestra ese mismo monto.
- Ninguna temporada necesita cambiar sus fechas al pasar de año.

## 13. Preguntas abiertas

Ninguna. Decisiones tomadas por defecto que el usuario puede cambiar al aprobar:

- "Desde" es el mínimo de adulto entre temporadas y base, sin el base si nunca se cobra.
- En la conversión, entre temporadas repetidas por año queda la vigente o la más próxima.
- El cambio de la base va en dos pasos para no cortar la venta durante el despliegue.
