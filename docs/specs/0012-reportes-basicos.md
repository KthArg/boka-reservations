# 0012 — Reportes básicos para el operador

- **Estado**: approved
- **Autor**: KthArg
- **Creado**: 2026-06-06
- **Última actualización**: 2026-06-06
- **Rama**: feat/0012-reportes-basicos (cuando aplique)
- **PR**: # (cuando aplique)

## 1. Contexto y motivación

El operador (admin y staff) ya puede gestionar tours, reservas, guías y cancelaciones, pero no tiene forma de **ver el negocio agregado**: cuánto facturó en un período, qué tan llenas van las salidas, cuánto devolvió en reembolsos, o cuáles son sus tours más vendidos. Hoy esa información solo existe fila por fila en el panel de reservas (y en el export CSV de reservas del spec 0008), sin totales ni cortes por período.

Esta feature agrega una sección de **reportes básicos** en el panel: cuatro vistas agregadas con filtro por rango de fechas, pensadas para que el operador entienda su operación de un vistazo y pueda bajar los datos a CSV para su contabilidad. Es la base sobre la que más adelante se podrían construir gráficos, comparativas entre períodos o reportes programados (todo eso queda fuera de este spec).

El público es **interno** (admin y staff). No hay nada visible para el turista ni para el guía.

## 2. Objetivos

- Permitir que admin y staff vean los **ingresos** (bruto, reembolsado y neto) de un período, con desglose por tour.
- Permitir que vean **reservas y ocupación** por tour en un período (tiquetes vendidos, % de ocupación de las salidas y tasa de no-show de las salidas ya pasadas).
- Permitir que vean el total de **reembolsos** (cantidad y monto) y la tasa de cancelación del período.
- Permitir que vean el **ranking de tours** (top) por ingresos y por reservas del período.
- Permitir **exportar cada reporte a CSV** para uso contable, reutilizando el patrón de export del spec 0008.

## 3. Fuera de alcance

- **No** hay gráficos ni visualizaciones (líneas, barras, tortas). Los reportes son tablas y números. Los gráficos son una iteración futura.
- **No** hay reportes programados ni envío por email. El operador consulta on-demand.
- **No** hay un constructor de reportes a medida ni filtros más allá del rango de fechas (no se filtra por guía, por estado de pago puntual, por cliente, etc.).
- **No** hay exportación a PDF ni a Excel nativo; solo CSV (UTF-8).
- **No** hay comparativa entre períodos ("junio vs mayo") ni proyecciones.
- **No** se soporta reporting **multi-moneda**: los montos se agregan asumiendo la moneda única del MVP (USD). Si en el futuro coexisten monedas, el desglose por moneda es otro spec.
- **No** se crean tablas nuevas ni se modifican datos existentes; todos los reportes son de **solo lectura** sobre el schema actual.
- **No** hay reportes por guía ni de performance de guías (candidato a spec futuro).

## 4. Historias de usuario

> Como **administrador**, quiero ver cuánto facturé (bruto y neto de reembolsos) en un rango de fechas, desglosado por tour, para entender qué genera ingresos y conciliar con mi contabilidad.

> Como **staff de operación**, quiero ver cuántas reservas y qué ocupación tuvieron las salidas de un período, para evaluar la demanda y la utilización de cupos.

> Como **operador**, quiero exportar cualquiera de estos reportes a CSV, para trabajarlos en mi hoja de cálculo o pasárselos a mi contador.

Criterios de aceptación:

- [ ] La sección de reportes vive bajo `/dashboard/reports` y solo es accesible para usuarios con rol `admin` o `staff`; un usuario sin esos roles recibe el mismo tratamiento que el resto del panel (redirect/forbidden).
- [ ] La página tiene un selector de **rango de fechas** (desde / hasta) que aplica a los cuatro reportes a la vez. Por defecto muestra el **mes en curso**.
- [ ] El rango es obligatorio y no puede exceder **un año** (mismo límite que el export del 0008). Si `desde > hasta`, se muestra un error de validación y no se consulta.
- [ ] **Ingresos**: muestra bruto, reembolsado y neto del período (en la moneda configurada), más una tabla por tour con esas tres columnas. Los montos se muestran formateados (no en cents crudos).
- [ ] **Reservas y ocupación**: tabla por tour con cantidad de reservas confirmadas, tiquetes vendidos, capacidad total de las salidas del período, % de ocupación y tasa de no-show (reservas confirmadas de salidas ya pasadas sin check-in registrado).
- [ ] **Reembolsos**: muestra cantidad y monto total de reembolsos acreditados del período, y la tasa de cancelación = reservas canceladas (`cancelled` o `refunded`) sobre las reservas válidas de las salidas del período (válidas = `confirmed`+`cancelled`+`refunded`, excluyendo `pending_payment` colgadas).
- [ ] **Top tours**: lista los tours ordenados por ingreso neto y, en una vista alterna, por cantidad de reservas (top 10).
- [ ] Cada reporte tiene un botón **"Exportar CSV"** que descarga los datos del reporte con el rango de fechas vigente.
- [ ] Un período sin datos muestra ceros / tabla vacía con un mensaje claro, no un error.
- [ ] Todos los textos están en ES y EN (i18n).

## 5. Diseño técnico

### Fuentes de datos (sin cambios al schema, solo lectura)

Todos los reportes se calculan sobre tablas existentes: `payments` (montos cobrados), `refunds` (reembolsos), `bookings` (reservas, tiquetes, estado), `tour_instances` (capacidad y fecha de salida) y `tours` (nombre).

### Agregación en la DB vía funciones SQL (RPC)

Los agregados (sumas, conteos, group by con joins y filtro por fecha) se calculan en Postgres mediante **funciones SQL de solo lectura**, no trayendo filas a la app para sumarlas en JS. Se exponen como RPC.

**Autorización (corrige una suposición errónea de la primera versión del spec):** el panel admin lee con la **sesión autenticada del usuario** (`createSupabaseServerClient`) respetando RLS, no con `service_role`. `bookings`, `payments` y `notifications` tienen política `select_admin_staff` para `authenticated` desde el spec 0008 (migración `20260530000014`), y `refunds` desde el 0011 (`refunds_select_admin_staff`). Por eso las funciones de reporte son **`SECURITY INVOKER`** (corren con el rol del que las llama) y se invocan con el server client autenticado: así las RLS de admin/staff sobre las tablas base se aplican como defensa en profundidad, y no hay escalamiento de privilegios. La autorización primaria sigue siendo el guard de ruta `requireAnyRole(ADMIN_PANEL_ROLES)` (constante de `@shared/constants/bookings`, no literal). Las funciones llevan `SET search_path = ''` (buena práctica del proyecto) y `GRANT EXECUTE ... TO authenticated`.

Tres funciones, separadas por **semántica de fecha** (cada reporte cuenta sobre una fecha distinta, y mezclarlas en una sola función sería confuso). Se nombra la **cadena de joins** de cada una para que la implementación no improvise:

1. `report_revenue(p_from timestamptz, p_to timestamptz)` — base de fecha: **fecha del pago** (`payments.created_at`, criterio de caja: plata efectivamente cobrada en el período). Joins: `payments → bookings → tour_instances → tours` para el bruto; `refunds → bookings → tour_instances → tours` para lo reembolsado. Devuelve una fila por tour con: `tour_id`, `name_es`, `name_en`, `gross_cents` (suma de `payments.amount_cents` con `status='succeeded'` y `created_at` en rango), `refunded_cents` (suma de `refunds.amount_cents` con `status='succeeded'` y `refunds.created_at` en rango), `net_cents` (`gross - refunded`), `currency`. Alimenta **Ingresos** y **Top tours por ingreso**. **Descalce temporal documentado**: el bruto se cuenta por fecha de pago y lo reembolsado por fecha de refund; un refund de un pago de un período anterior resta en _este_ período (y un refund posterior no resta acá). Es intencional (cada movimiento por su fecha de caja), pero implica que `net_cents` de un período **no** es "el bruto de ese período menos sus propios reembolsos". Ver caso borde de net negativo.

2. `report_occupancy(p_from timestamptz, p_to timestamptz)` — base de fecha: **fecha de la salida** (`tour_instances.starts_at`, criterio operativo: salidas que ocurren en el período). Joins: `tour_instances → tours`, con subconsultas/joins a `bookings` por `tour_instance_id`. Devuelve una fila por tour con: `tour_id`, `name_es`, `name_en`, `bookings_count` (reservas con `status='confirmed'` — el check-in es la columna `checked_in_at`, no un estado, así que no cambia el conteo), `tickets_sold` (suma de `tickets_adult+tickets_child+tickets_student` de esas reservas), `capacity_total` (suma de `tour_instances.capacity_total` de las salidas del rango), `occupancy_pct` (`tickets_sold / NULLIF(capacity_total,0)`), `no_show_count` (reservas `confirmed` de salidas **ya pasadas** —`starts_at < now()`— con `checked_in_at IS NULL`) y `past_bookings_count` (reservas `confirmed` de salidas pasadas del rango, denominador del no-show). Alimenta **Reservas y ocupación** (incl. tasa de no-show) y **Top tours por reservas**.

3. `report_refunds_summary(p_from timestamptz, p_to timestamptz)` — devuelve una sola fila con: `refunds_count` y `refunds_amount_cents` (refunds `succeeded` por `refunds.created_at` en rango); `cancelled_count` (reservas con `status IN ('cancelled','refunded')` cuya salida `starts_at` cae en el rango — ver nota de estados); `valid_bookings_count` (reservas con `status IN ('confirmed','cancelled','refunded')` de salidas del rango, **excluye `pending_payment`** colgadas); y `currency`. La **tasa de cancelación** = `cancelled_count / NULLIF(valid_bookings_count,0)` se calcula en la app.

**Nota de estados** (relevante para 2 y 3): una reserva cancelada queda en `status='cancelled'`; cuando su reembolso se **acredita**, el worker (`settle_refund`, 0011) la pasa a `status='refunded'`. Por eso "cancelada" = `status IN ('cancelled','refunded')`: ambas son reservas que se cancelaron, la diferencia es solo si el refund ya se acreditó. La tasa de cancelación mide reservas canceladas (con o sin refund), no reembolsos acreditados (esos son la métrica de la sección Reembolsos).

**Top tours** no necesita función propia: es la salida de `report_revenue` ordenada por `net_cents` desc (top 10) y la de `report_occupancy` ordenada por `bookings_count` desc (top 10), resuelto en la app.

### Capa de aplicación

- `web/lib/reports/queries.ts`: wrappers tipados que llaman cada RPC con el **server client autenticado** (`createSupabaseServerClient`, sesión del admin/staff) —igual que el resto del panel (`export-repository.ts`)—, validan el rango, y normalizan a tipos de `cents → display` (reutilizando `lib/format/money.ts`). Al ser funciones `SECURITY INVOKER`, así corren bajo la RLS del usuario (defensa en profundidad).
- `web/lib/reports/csv.ts`: serialización a CSV de cada reporte. El helper del 0008 (`bookingsToCsv`) es específico de reservas, así que se extrae/crea un **helper genérico** de CSV (toma headers + filas, escapa comas/comillas/saltos de línea y antepone BOM UTF-8 para que Excel abra bien los acentos). El plan de tests lo cubre.
- Página server component `web/app/[locale]/(admin)/dashboard/reports/page.tsx`: guard `requireAnyRole(ADMIN_PANEL_ROLES)`, lee `from`/`to` de searchParams (default: mes en curso), invoca los wrappers y renderiza las cuatro secciones. Un client component maneja el selector de fechas (actualiza la URL con `from`/`to`).
- Route handler `web/app/[locale]/(admin)/dashboard/reports/export/route.ts`: recibe `report`, `from`, `to`; guard `requireAnyRole(ADMIN_PANEL_ROLES)`; corre la query y responde `text/csv` con `Content-Disposition: attachment` (espejo de `bookings/export/route.ts`).

### Rango de fechas y zona horaria

El selector entrega los límites como timestamptz. Los días se interpretan en horario de **Costa Rica** (`America/Costa_Rica`, UTC-6): el front arma `from` = inicio del día "desde" y `to` = fin del día "hasta" en hora CR, y las funciones comparan en UTC. Se documenta para evitar el corte de día equivocado en los bordes.

## 6. Modelo de datos

Sin cambios de tablas. Se agregan **índices** para soportar los filtros por fecha de los agregados (hoy inexistentes), en una migración nueva:

- **Tabla**: `payments` — índice `payments_succeeded_created_idx` parcial sobre `(created_at) WHERE status = 'succeeded'`.
- **Tabla**: `refunds` — índice `refunds_succeeded_created_idx` parcial sobre `(created_at) WHERE status = 'succeeded'`.
- **Tabla**: `tour_instances` — ya existe `tour_instances_tour_starts_idx (tour_id, starts_at)`, suficiente para `report_occupancy`. Sin índice nuevo.
- **Tabla**: `bookings` — ya existe `bookings_instance_idx` y `bookings_status_idx`; los joins de los reportes parten de `tour_instances`/`payments`, así que no se agrega índice nuevo salvo que el plan lo pida en implementación.

- **Funciones**: las tres `report_*` son `SECURITY INVOKER` (corren con el rol del invocador), `SET search_path = ''`, con `GRANT EXECUTE ... TO authenticated`. Todas las tablas que joinean son legibles por la sesión autenticada de admin/staff: `bookings`/`payments` (políticas `select_admin_staff` del 0008), `refunds` (`refunds_select_admin_staff` del 0011), y `tours`/`tour_instances` (política `select_authenticated USING (true)` del 0004/0005). No hace falta política RLS nueva.

- **Migración**: `supabase/migrations/<ts>_report_functions_and_indexes.sql` — crea las tres funciones `report_*` (INVOKER) y los dos índices parciales.

## 7. Estados y transiciones

No aplica. Los reportes son de solo lectura y no modifican ninguna máquina de estados.

## 8. Casos borde y errores

- **Período sin datos**: las funciones devuelven 0 filas / sumas en `NULL`; los wrappers normalizan a cero y la UI muestra "Sin datos en el período" en vez de error.
- **`desde > hasta`**: validación en la app antes de consultar; se muestra error de rango y no se llama a la DB.
- **Rango mayor a un año**: se rechaza con el mismo mensaje que el export del 0008 (cap de 1 año).
- **División por cero en ocupación / tasa**: `NULLIF(denominador,0)` en SQL → `NULL` → la UI muestra "—" en vez de `NaN`/error.
- **Reserva sin pago exitoso** (p. ej. `pending_payment` colgada, ver deuda técnica): no suma a ingresos (la función filtra `payments.status='succeeded'`); se **excluye** del denominador de la tasa de cancelación (`valid_bookings_count` solo cuenta `confirmed`/`cancelled`/`refunded`). Se documenta que "ingresos" cuenta caja, no reservas.
- **Múltiples pagos por reserva**: se asume a lo sumo un `payments` con `status='succeeded'` por reserva (el flujo de checkout del 0006 confirma uno). Si por reintentos existieran dos `succeeded`, la función los suma todos (refleja caja real); el schema no lo impide con un unique, así que es un supuesto, no una garantía.
- **Reembolso parcial vs total**: el modelo del 0011 solo permite reembolso total, así que `refunded_cents ≤ gross_cents` por tour en el caso normal; si por datos históricos no fuera así, `net_cents` podría dar negativo — se muestra tal cual y se documenta (no se clampea a 0 para no ocultar inconsistencias).
- **Monedas mixtas**: si existieran pagos en más de una moneda en el rango, la suma sería incorrecta. El MVP asume una sola moneda; las funciones devuelven la `currency` observada y, si detectan más de una, se documenta como fuera de alcance (no se mezcla silenciosamente — ver pregunta abierta).
- **Concurrencia**: no aplica escritura; lecturas concurrentes no tienen problema. Un reporte puede diferir de otro por segundos si una reserva se confirma entre dos consultas — aceptable para un reporte de gestión.

## 9. Impacto en otras áreas

- **Panel admin**: nueva entrada de navegación "Reportes" (`/dashboard/reports`), visible para admin y staff.
- **Emails**: ninguno.
- **Worker**: sin cambios.
- **Reportes/métricas**: es la feature de reportes en sí.
- **Cancelaciones/refunds/pagos**: solo lectura; ninguna lógica de negocio de pagos cambia.
- **i18n**: nuevo namespace `reports` en `web/locales/es.json` y `en.json` (títulos, columnas, mensajes de rango/vacío, etiquetas de export).
- **Rutas**: segmentos en **inglés** (`reports`, `export`), por la convención de URLs del proyecto.

## 10. Plan de tests

- **Integración (web, DB real)** — el grueso, porque la lógica vive en SQL:
  - `report_revenue`: siembra tours/salidas/bookings/payments/refunds en un rango conocido y verifica bruto, reembolsado y neto por tour; verifica que pagos fuera del rango no cuentan; que pagos no `succeeded` no cuentan.
  - `report_occupancy`: verifica tiquetes vendidos, capacidad y % por tour; salidas fuera del rango no cuentan; reservas canceladas no suman tiquetes; **no-show**: una reserva `confirmed` de salida pasada sin `checked_in_at` cuenta como no-show, una con check-in no, y las salidas futuras no entran al denominador del no-show.
  - `report_refunds_summary`: verifica conteo/monto de refunds; que `cancelled` y `refunded` ambos cuentan como cancelada; que `pending_payment` queda **fuera** del denominador `valid_bookings_count`.
  - Borde: período vacío → ceros; `NULLIF` evita división por cero.
- **Unit (web)**:
  - Validación del rango (`desde ≤ hasta`, cap de 1 año, default mes en curso).
  - Serialización CSV de cada reporte (headers correctos, montos formateados, escape de comas/comillas en nombres de tour).
- **Manual (documentado en el PR)**: abrir `/dashboard/reports` como admin y como staff, cambiar el rango, verificar los cuatro reportes y descargar un CSV de cada uno.

## 11. Plan de rollout

- No requiere feature flag (sección nueva, no reemplaza nada).
- No requiere migración de datos (solo funciones + índices, idempotente en una DB existente).
- No requiere comunicación previa a operadores más allá de avisar que la sección existe.
- **Reversible**: si algo falla, se puede ocultar la entrada de navegación; las funciones e índices son inertes (no afectan otras features). Para revertir del todo: `DROP FUNCTION` de las tres + `DROP INDEX` de los dos.

## 12. Métricas de éxito

- El operador puede obtener los ingresos netos de un mes en menos de 10 segundos sin pedir ayuda ni exportar reservas a mano.
- Los totales de los reportes cuadran con la realidad: el ingreso neto del período coincide con (pagos succeeded − refunds succeeded) de ese período, verificado contra una consulta manual en al menos una validación.
- Cada uno de los cuatro reportes se puede exportar a CSV y abrir correctamente en una hoja de cálculo.

## 13. Preguntas abiertas

**Decisiones tomadas (default, no bloquean la implementación; confirmables antes de usar los números para contabilidad real):**

- **Audiencia**: admin y staff ven los cuatro reportes, incluyendo ingresos (decidido con el usuario al definir el alcance). No se restringe lo financiero solo a admin.
- **Base de fecha de ingresos**: criterio de **caja** (fecha del pago, `payments.created_at`). Es el default más común y el que cuadra con "plata cobrada en el período". La alternativa (fecha de la salida, criterio devengado) queda anotada por si el operador la prefiere; cambiarla es tocar solo la condición de fecha de `report_revenue`.
- **Moneda**: se asume la moneda única del MVP (USD). El desglose multi-moneda es fuera de alcance (sección 3).

Pendiente de confirmar con el usuario antes del cierre contable real (no bloquea codear):

- [ ] **Pregunta**: ¿El operador quiere los ingresos por **fecha de pago** (lo implementado) o por **fecha de la salida del tour**? **Dueño**: usuario (operador). **Antes de**: usar los reportes para conciliación contable en producción.
