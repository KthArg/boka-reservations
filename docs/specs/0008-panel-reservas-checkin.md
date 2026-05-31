# 0008 — Panel de reservas y check-in

- **Estado**: approved
- **Autor**: Kenneth
- **Creado**: 2026-05-30
- **Última actualización**: 2026-05-30 (rev. 3: export con rango de fechas obligatorio ≤1 año en vez de cap por filas; confirmado total en lista / desglose en detalle+CSV)
- **Rama**: feat/0008-panel-reservas-checkin
- **PR**: # (cuando aplique)

## 1. Contexto y motivación

Hoy el sistema captura reservas (spec 0006) y envía notificaciones por email (spec 0007), pero el staff del operador no tiene ninguna forma de **ver** las reservas que entran. Para operar el día a día — saber quién viene a cada tour, cuánta gente esperar en el punto de encuentro, marcar quién se presentó — el operador depende de mirar la base de datos directamente. Eso no es viable para personal no técnico.

Esta feature entrega el primer panel operativo de reservas, dentro del panel autenticado existente (las rutas del panel viven bajo `/dashboard`, ver sección 5). El staff podrá listar y filtrar reservas, abrir el detalle de cada una, marcar el **check-in** (presentación del cliente el día del tour), ver de un vistazo los **tours que arrancan hoy**, y **exportar** la lista filtrada a CSV para uso offline o contabilidad.

El actor principal es el **staff interno** del operador (roles `admin` y `staff`). No es una pantalla pública ni para turistas. El rol `guide` queda fuera por ahora: la vista personalizada por guía depende de la asignación de guías a instancias de tour, que se implementa en el spec 0009.

## 2. Objetivos

- Permitir que el staff liste todas las reservas con filtros por rango de fecha del tour, tour, estado y búsqueda por cliente, sin tener que tocar la base de datos.
- Permitir que el staff abra el detalle completo de una reserva (datos del cliente, tour, pago, notificaciones) desde la lista.
- Permitir que el staff marque y revierta el check-in de una reserva confirmada el día del tour.
- Ofrecer una vista rápida "Hoy" con las instancias de tour que arrancan en el día en curso y su ocupación.
- Permitir exportar la lista de reservas actualmente filtrada a un archivo CSV.

## 3. Fuera de alcance

- **No se crea un modelo de tickets por persona** (`booking_tickets`). La reserva guarda la cantidad por tipo de tiquete (`tickets_adult`, `tickets_child`, `tickets_student`); no hay datos por-asistente individual que justifiquen una tabla de tickets. El check-in es a nivel de reserva completa, no por persona. Si en el futuro se necesita check-in granular, será un spec propio.
- **No se introduce una tabla de auditoría** (`audit_logs`). El check-in registra solo su estado actual (`checked_in_at`/`checked_in_by`), sin historial de cambios. Ver justificación en sección 5.
- **No se filtra ni personaliza por guía.** "Mis tours de hoy" en el sentido de "los tours asignados a mí" requiere la asignación guía→instancia del spec 0009. Esta feature entrega una vista "Hoy" global (todas las instancias del día), no por-guía.
- **No se editan, cancelan ni reembolsan reservas desde el panel.** Modificar tiquetes, cancelar o reembolsar es una capacidad aparte (futuro spec). El check-in es la única mutación que introduce esta feature.
- **No se crean ni reasignan instancias de tour** desde esta pantalla.
- **No hay notificaciones nuevas.** Marcar check-in no dispara ningún email.
- **No hay filtros del lado del cliente ni scroll infinito.** La lista es server-rendered con paginación por query params (ver sección 5).
- **No se exporta a formatos distintos de CSV** (sin Excel nativo, sin PDF).

## 4. Historias de usuario

### Historia 1 — Listar y filtrar reservas

> Como staff del operador, quiero ver todas las reservas en una lista filtrable, para encontrar rápido la reserva o el conjunto de reservas que necesito.

Criterios de aceptación:

- [ ] `/dashboard/bookings` muestra una tabla con: fecha y hora del tour (`tour_instances.starts_at`), nombre del tour, cliente (`customer_name`), cantidad total de tiquetes (suma de adult+child+student), estado de la reserva, estado de pago, e indicador de check-in.
- [ ] La tabla se ordena por fecha de inicio del tour (`tour_instances.starts_at`) ascendente por defecto.
- [ ] Existe un filtro por **rango de fechas** del tour (desde / hasta sobre `starts_at`).
- [ ] Existe un filtro por **tour** (selección de un tour específico).
- [ ] Existe un filtro por **estado de la reserva** (`pending_payment`, `confirmed`, `cancelled`, `refunded`).
- [ ] Existe una **búsqueda por cliente** que matchea contra `customer_name` y `customer_email` (case-insensitive, substring).
- [ ] Los filtros se reflejan en la URL (query params), de modo que la vista filtrada es enlazable y sobrevive a un refresh.
- [ ] Si no hay resultados, se muestra un estado vacío claro ("No hay reservas que coincidan con los filtros").
- [ ] La lista pagina de a 50 filas; navegar entre páginas preserva los filtros activos.

### Historia 2 — Ver detalle de una reserva

> Como staff, quiero abrir una reserva y ver toda su información, para responder consultas del cliente y verificar el estado del pago.

Criterios de aceptación:

- [ ] Desde cada fila de la lista se accede a `/dashboard/bookings/[id]`.
- [ ] El detalle muestra: datos del cliente (nombre, email), tour e instancia (nombre, fecha, hora de `starts_at`/`ends_at`), desglose de tiquetes (adult/child/student) y total, monto total y moneda, estado de la reserva con sus timestamps (`created_at`, `updated_at`), estado y proveedor del pago, y estado de check-in.
- [ ] El detalle lista las notificaciones asociadas a la reserva (tipo, estado, fecha de envío), si existen.
- [ ] Desde el detalle se puede marcar / revertir el check-in (ver Historia 3).

### Historia 3 — Marcar check-in

> Como staff en el punto de encuentro, quiero marcar que un cliente se presentó, para llevar el control de asistencia del tour.

Criterios de aceptación:

- [ ] Solo las reservas en estado `confirmed` pueden marcarse como check-in. Para `pending_payment`, `cancelled` o `refunded` la acción no está disponible.
- [ ] El check-in es un toggle: marcar registra el momento y quién lo marcó; revertir lo limpia.
- [ ] Marcar check-in pide una confirmación breve antes de aplicar (evita clicks accidentales en el celular).
- [ ] Una vez marcado, la fila y el detalle muestran el check-in con su timestamp.
- [ ] La acción es idempotente: marcar dos veces no cambia el timestamp original; revertir y volver a marcar genera un timestamp nuevo.
- [ ] El check-in registra quién lo marcó (`checked_in_by`) y cuándo (`checked_in_at`).

### Historia 4 — Vista "Hoy"

> Como staff, al empezar el día quiero ver qué tours arrancan hoy y cuánta gente espero, para preparar la operación.

Criterios de aceptación:

- [ ] Existe `/dashboard/bookings/hoy` que muestra las instancias de tour cuyo `starts_at` cae en el día en curso (zona horaria del operador).
- [ ] Por cada instancia se muestra: nombre del tour, hora de inicio, `capacity_total`, reservados confirmados, y cuántas reservas hicieron check-in.
- [ ] Desde cada instancia se accede a la lista de reservas de esa instancia, ya filtrada.

### Historia 5 — Exportar a CSV

> Como staff o contabilidad, quiero descargar las reservas filtradas como CSV, para trabajarlas offline o cruzarlas con otros sistemas.

Criterios de aceptación:

- [ ] El export **exige un rango de fechas** (`dateFrom` y `dateTo` sobre `starts_at`). El botón "Exportar CSV" está deshabilitado mientras no haya un rango definido, con un texto que lo explique.
- [ ] El rango no puede exceder **un año** (`dateTo - dateFrom <= 366 días`); si lo excede, el endpoint responde `400` con un mensaje claro ("El rango de exportación no puede superar un año").
- [ ] El botón exporta las reservas que coinciden con el rango y los demás filtros activos (no solo la página visible).
- [ ] El CSV incluye las columnas definidas en la sección 5 y usa codificación UTF-8 con BOM (para que Excel respete tildes).
- [ ] Los montos se exportan en la unidad mayor de la moneda (ej. `125.00`), convertidos desde `total_amount_cents`, con la columna de moneda al lado.
- [ ] El nombre del archivo incluye el rango exportado (ej. `reservas-2026-01-01_2026-05-30.csv`).

## 5. Diseño técnico

### Convención de rutas (importante)

El panel autenticado usa el route group `(admin)` pero el segmento de URL real es **`/dashboard`** (ej. los tours están en `/dashboard/tours`, no `/admin/tours`). Todas las rutas nuevas de esta feature cuelgan de `/dashboard/bookings`.

### Capa de datos / queries

Toda la lectura vive en `web/lib/booking/repository.ts` (nuevo módulo dentro del paquete `booking` existente), siguiendo el patrón de `lib/tours/repository.ts` (funciones server-only que usan el cliente Supabase de servidor). Función principal:

```
listBookingsForAdmin(filters): Promise<{ rows: AdminBookingRow[]; total: number }>
```

`filters` incluye: `dateFrom?`, `dateTo?`, `tourId?`, `status?`, `search?`, `page` (default 1), `pageSize` (50). La query une `bookings` con `tour_instances` y `tours` (vía PostgREST embedding) para traer nombre del tour y `starts_at`, y embebe `payments` para el estado de pago. El `total` se obtiene con `count: 'exact'` para calcular la paginación.

Funciones auxiliares en el mismo módulo:

- `getBookingDetailForAdmin(id)` — reserva + instancia + tour + pago + notificaciones.
- `listTodayInstances(tz)` — instancias con `starts_at` dentro del día actual, con agregados de reservados y check-ins.
- `listBookingsForExport(filters)` — misma query que el listado pero sin paginación, para el CSV.

Tipos en `web/lib/booking/types.ts` (sumar a lo existente): `AdminBookingRow`, `AdminBookingDetail`, `BookingFilters`, `TodayInstance`.

### Páginas (todas server-rendered)

- `web/app/[locale]/(admin)/dashboard/bookings/page.tsx` — lista. Lee filtros desde `searchParams`, llama `listBookingsForAdmin`, renderiza la tabla. Los controles de filtro son un form que hace push de query params (Client Component co-locado para la interacción; el resto server-rendered, igual que el patrón de tours).
- `web/app/[locale]/(admin)/dashboard/bookings/[id]/page.tsx` — detalle.
- `web/app/[locale]/(admin)/dashboard/bookings/hoy/page.tsx` — vista "Hoy".

Se agrega un `<Link href="/dashboard/bookings">` al `<nav>` del sidebar en `web/app/[locale]/(admin)/layout.tsx` (la navegación es una lista de Links hardcodeada, no un array de config).

### Mutación: check-in (Server Action)

`web/lib/booking/checkin-action.ts` expone una Server Action `toggleCheckIn(bookingId, action: 'check_in' | 'revert')`:

1. Valida sesión y rol (`admin` o `staff`) con el helper de `lib/auth/server` — si no, error.
2. Lee la reserva; si no está `confirmed`, rechaza.
3. Para `check_in`: setea `checked_in_at = now()` y `checked_in_by = <user.id>` **solo si `checked_in_at IS NULL`** (idempotente). Para `revert`: setea ambos a `NULL`.
4. `revalidatePath` de la lista y el detalle.

La acción corre del lado servidor; la confirmación de la Historia 3 es un diálogo del Client Component que invoca la action.

### Export CSV

`web/app/[locale]/(admin)/dashboard/bookings/export/route.ts` — Route Handler `GET` que toma los mismos query params que la lista, valida sesión + rol, llama `listBookingsForExport`, arma el CSV en memoria y responde con `Content-Type: text/csv; charset=utf-8` y `Content-Disposition: attachment`. El contenido arranca con BOM (`﻿`). La serialización vive en una función pura `bookingsToCsv(rows)` testeable por unidad.

**Rango de fechas obligatorio y acotado**: el export carga todas las filas en memoria (sin streaming), así que el modo de falla a evitar es "exportar sin filtros" → la tabla entera. En vez de un tope por cantidad de filas (poco intuitivo para el usuario), el export **exige un rango de fechas** y lo limita a un máximo de **un año** (`366 días`). Esto acota el resultado por intención del usuario ("exportá este período"), no por un número mágico de filas, y elimina de raíz la query sin límite. El handler valida: si falta `dateFrom`/`dateTo` → `400`; si el rango supera 366 días → `400` con mensaje. Para el volumen esperado del MVP, un año de reservas entra holgadamente en memoria.

**Columnas del CSV** (en este orden):
`booking_id, tour, fecha_inicio, hora_inicio, cliente, email, tickets_adult, tickets_child, tickets_student, total_tickets, estado_reserva, estado_pago, monto, moneda, check_in_at, created_at`.

### Acceso a datos y RLS

Hoy `bookings` y `payments` tienen RLS habilitada **sin políticas para `authenticated`** (solo accede el `service_role`; ver migración 0012). Hay dos caminos:

- **(A) Política RLS de lectura para staff/admin** sobre `bookings`, `payments` y `notifications`, consistente con el patrón de `tour_instances` (que sí tiene `select_authenticated USING (true)`), y leer con el cliente Supabase de servidor del usuario autenticado.
- **(B) Leer con `service_role`** desde el código server-only del panel, sin tocar RLS.

Se elige **(A)**: añadir políticas `SELECT` para `authenticated` restringidas a usuarios con rol `admin`/`staff` (usando el claim de rol del JWT, patrón `(select auth.jwt())` ya documentado en las decisiones de RLS del proyecto). Es más consistente con el resto del admin y evita repartir el `service_role` en más rutas. La escritura del check-in la hace la Server Action; si la política de UPDATE para staff resulta engorrosa, la action puede usar `service_role` puntualmente (decisión de implementación, se valida contra las convenciones de RLS).

### Decisiones no obvias

- **Check-in a nivel reserva, no por ticket.** El roadmap mencionaba `booking_tickets.check_in_at`, pero esa tabla nunca se creó y no hay datos por-persona (solo conteos por tipo de tiquete). Crear tickets ahora sería modelar algo sin fuente de datos. Se opta por dos columnas en `bookings`.
- **Check-in es ortogonal al `status` de la reserva.** No se agrega un valor nuevo al CHECK de `bookings.status` (`pending_payment|confirmed|cancelled|refunded`). Una reserva "con check-in" sigue siendo `confirmed`; el check-in se modela con timestamps, no con la máquina de estados.
- **Lista server-rendered con query params**, consistente con el resto del admin. Evita estado de cliente, hace la vista enlazable, y reusa la misma capa de filtros para la exportación.
- **Vista "Hoy" es página propia**, no un filtro `?fecha=hoy` sobre la lista. "Hoy" es _instance-centric_ (agrupa por instancia con agregados de capacidad / confirmados / check-ins), una forma de datos y una UI distintas de la lista _booking-centric_. Un filtro de fecha daría una lista plana, que no sirve para preparar la jornada.
- **No se introduce `audit_logs` en esta feature.** El check-in es de bajo riesgo e idempotente; `checked_in_at` + `checked_in_by` alcanzan para operar y atribuir el último estado. Una tabla de auditoría genérica es infraestructura que conviene introducir en el primer spec que realmente la necesite (cancelaciones / refunds, donde hay dinero y el historial importa de verdad), con su diseño guiado por requisitos reales. Meterla ahora sería scope creep. Tradeoff aceptado: no queda historial de marca→revert→marca, solo el estado final; aceptable para check-in.

## 6. Modelo de datos

- **Tabla**: `bookings`
- **Acción**: alter
- **Columnas afectadas**:
  - `checked_in_at timestamptz NULL` (default NULL) — momento del check-in; NULL = no presentado.
  - `checked_in_by uuid NULL REFERENCES public.users(id)` — quién marcó el check-in.
- **Índices nuevos**: `bookings_checked_in_idx ON public.bookings (checked_in_at) WHERE checked_in_at IS NOT NULL` (parcial) para los agregados de la vista "Hoy".
- **Migración**: `supabase/migrations/20260530000014_add_checkin_to_bookings.sql` (incluye también las políticas RLS SELECT para `authenticated` sobre `bookings`/`payments`/`notifications` descritas en sección 5).

No se crean tablas nuevas. (`audit_logs` se difiere a un spec futuro — ver "Decisiones no obvias" en sección 5.)

También hay que regenerar/actualizar `web/types/database.ts` con las columnas nuevas de `bookings`.

## 7. Estados y transiciones

No se modifica la máquina de estados de `bookings` (`pending_payment → confirmed → cancelled/refunded`). El check-in es un atributo temporal ortogonal:

```
checked_in_at: NULL  --[check_in]-->  <timestamp>
               <timestamp>  --[revert]-->  NULL
```

Precondición para ambas transiciones: `booking.status = 'confirmed'`. No hay estado terminal nuevo.

## 8. Casos borde y errores

- **Check-in sobre reserva no confirmada**: la action rechaza con error; la UI no ofrece el botón salvo en `confirmed`.
- **Reserva cancelada/reembolsada después del check-in**: esos flujos están fuera de alcance acá, pero el dato `checked_in_at` queda; la lista muestra ambos (estado + check-in previo) sin contradicción.
- **Doble click / doble submit del check-in**: idempotente — el `UPDATE` condicionado a `checked_in_at IS NULL` no pisa el timestamp original.
- **Filtros con rango de fechas invertido** (`dateFrom > dateTo`): se devuelve lista vacía con el estado vacío; no es un error duro.
- **Export sin filtros o con rango enorme**: el export no usa streaming; exige un rango de fechas de hasta un año (sección 5). Sin rango o con rango >366 días, el endpoint responde `400` con un mensaje claro en vez de cargar la tabla entera en memoria.
- **Búsqueda con caracteres especiales**: se usa `ilike` parametrizado vía el query builder de Supabase; no hay interpolación de strings en SQL.
- **Usuario sin rol staff/admin** que llega a la URL: el layout/guard del panel exige sesión; la página y las actions verifican rol y rechazan/redirigen.
- **Zona horaria de "Hoy"**: el "día en curso" se calcula en la TZ del operador (Costa Rica, UTC-6), no en UTC, para que "hoy" coincida con la jornada real. La TZ es constante por ahora (no multi-operador).

## 9. Impacto en otras áreas

- **Panel admin**: nuevo ítem "Reservas" en el sidebar (`(admin)/layout.tsx`); tres páginas nuevas más un route handler de export.
- **Emails / templates**: sin cambios. El check-in no dispara notificaciones.
- **Worker**: sin cambios.
- **Reportes / métricas**: el CSV es el primer mecanismo de export; sienta base para reportes futuros.
- **Cancelaciones / refunds / pagos**: sin cambios de comportamiento.
- **i18n**: textos nuevos en ES y EN bajo un namespace `bookings` en `web/locales/es.json` y `web/locales/en.json` (lista, filtros, detalle, vista "Hoy", botones de check-in y export, estados vacíos).
- **Modelo de datos**: dos columnas nuevas en `bookings`, políticas RLS de lectura para staff, y actualización de `web/types/database.ts`. Sin tablas nuevas.

## 10. Plan de tests

- **Unit** (Vitest, web):
  - Mapeo de `searchParams` a `BookingFilters` tipados (defaults de paginación, parseo de fechas, ignorar params inválidos).
  - `bookingsToCsv`: orden de columnas, BOM, conversión de `total_amount_cents` a unidad mayor, escapado de comas/comillas/saltos de línea en nombres.
  - Lógica de elegibilidad de check-in (solo `confirmed`).
- **Integración** (requieren `supabase start`):
  - `listBookingsForAdmin` con cada filtro y combinaciones, incluyendo paginación y `total` correcto.
  - `toggleCheckIn`: marca, idempotencia (doble marca no cambia timestamp), revert, rechazo sobre reserva no confirmada, y que `checked_in_by` queda con el id del actor.
  - `listTodayInstances`: agregados de reservados y check-ins correctos para instancias del día.
  - Route handler de export: responde CSV con las filas filtradas correctas.
  - RLS: un usuario `authenticated` con rol staff puede leer bookings; un `anon` no.
- **Manual (documentado en el PR)**: recorrido completo en `/dashboard/bookings` — filtrar, abrir detalle, marcar check-in en el celular, ver "Hoy", descargar CSV y abrirlo en Excel verificando tildes.

## 11. Plan de rollout

- **Feature flag**: no requiere. Es una sección nueva del admin, no reemplaza nada.
- **Migración de datos**: no requiere; las columnas nuevas nacen NULL.
- **Comunicación a operadores**: al lanzar, avisar al staff que ya pueden ver reservas y marcar check-in; breve instructivo de uso.
- **Reversibilidad**: las columnas y las políticas son aditivas; revertir es ocultar la sección del nav. Las migraciones no destruyen datos existentes.

## 12. Métricas de éxito

- El staff usa el panel para el check-in real: ≥80% de las reservas `confirmed` de tours pasados tienen `checked_in_at` (señal de uso efectivo en el punto de encuentro).
- Cero accesos directos a la base de datos por parte del staff para consultar reservas a partir del lanzamiento.
- La exportación CSV se usa al menos semanalmente por contabilidad en el primer mes.

## 13. Preguntas abiertas

Ninguna. Las cuatro preguntas de la rev. 1 se resolvieron (rev. 2):

- **Vista "Hoy"**: página propia (`/dashboard/bookings/hoy`). Resuelto.
- **`audit_logs`**: se difiere a un spec futuro; el check-in usa solo `checked_in_at`/`checked_in_by`. Resuelto.
- **Acotar el export**: rango de fechas obligatorio, máximo un año (`400` si falta o se excede). Resuelto.
- **Tiquetes en la lista**: total agregado (suma de adult+child+student) en la lista; desglose por tipo en detalle y CSV. Resuelto.
