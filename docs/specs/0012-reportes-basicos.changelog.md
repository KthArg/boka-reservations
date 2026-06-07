# Changelog — 0012 Reportes básicos

Spec: [0012-reportes-basicos.md](./0012-reportes-basicos.md)
Rama: feat/0012-reportes-basicos

## 2026-06-06 — Implementación completa, lista para PR

**Hecho**:

- **DB** (`20260606000022_report_functions_and_indexes.sql`): tres funciones SQL de solo lectura `report_revenue`, `report_occupancy`, `report_refunds_summary`, **`SECURITY INVOKER`** + `SET search_path=''` + `GRANT EXECUTE TO authenticated`. Dos índices parciales (`payments_succeeded_created_idx`, `refunds_succeeded_created_idx`) para los filtros por fecha. Grants defensivos de SELECT en `refunds`/`tours` para `authenticated`.
- **shared**: `ReportKind` (revenue/occupancy/refunds) y `ReportRangeError` en `shared/constants/reports.ts`.
- **Tipos**: las 3 funciones agregadas a `web/types/database.ts` a mano (estilo narrow, sin regenerar — evita el ensanchamiento del CLI, ver gotcha del proyecto).
- **lib/reports**: `range.ts` (validación + default mes en curso + límites de día en hora CR, rango medio-abierto), `queries.ts` (wrappers RPC con `createSupabaseServerClient` autenticado, server-only), `types.ts` (tipos puros + helpers `cancellationRate`/`noShowRate`/`formatRatioPct` — separado de queries para unit-testear sin `server-only`), `csv.ts` (serialización por reporte).
- **Helper CSV genérico**: `web/lib/format/csv.ts` (`toCsv`/`escapeCsvField`); se refactorizó `bookingsToCsv` (0008) para usarlo, eliminando la duplicación que marcó el spec-reviewer.
- **UI**: página `/dashboard/reports` (server component) con selector de rango (form GET, sin client JS) y 4 secciones (`RevenueSection`, `OccupancySection`, `RefundsSection`, `TopToursSection`). Guard `requireAnyRole(ADMIN_PANEL_ROLES)` con redirect. Export por reporte vía route handler `/dashboard/reports/export`. Entrada "Reportes" en la nav del panel (admin+staff). i18n namespace `reports` ES/EN (28 claves, paridad verificada).

**Por qué / decisiones**:

- **`SECURITY INVOKER` + sesión autenticada, no `service_role`** (corrección del spec-reviewer): el panel lee con la sesión del admin/staff respetando RLS (`bookings`/`payments` tienen `select_admin_staff` desde 0008, `refunds` desde 0011, `tours`/`tour_instances` `USING(true)`). Así las RLS aplican como defensa en profundidad y no hay escalamiento.
- **Semántica de fecha por reporte**: ingresos por fecha de **pago** (caja); ocupación por fecha de **salida**; reembolsos por fecha de **refund**. Documentado el descalce temporal gross/refund (net puede ser negativo legítimamente).
- **Refund por monto pagado / estados**: cancelada = `status IN ('cancelled','refunded')` (refunded = cancelada + refund acreditado por `settle_refund` del 0011); denominador de la tasa excluye `pending_payment`.
- **No-show** agregado al reporte de ocupación (lo pedía el roadmap): `confirmed` de salidas pasadas con `checked_in_at IS NULL`.
- **`occupancy_pct` casteado a `double precision`** porque PostgREST devuelve `numeric` como string.
- **Capacidad agregada aparte de reservas** en `report_occupancy` (CTEs) para no inflarla con el fan-out del join.
- **Zona horaria CR** (UTC-6) para los límites de día; rango medio-abierto `[from, to)` con `to` = inicio del día siguiente al "hasta".

**Tests** (corridos 2026-06-06 con `db reset` + cadena completa, todo verde):

- **Integración** `reports.test.ts` (3): las RPC se llaman con **sesión autenticada admin** (no service_role) para validar el camino real INVOKER+RLS+grant. Ventana aislada (feb 2024) con valores conocidos: bruto 30000 / reembolsado 5000 / neto 25000; ocupación 0.5, no-show 1/2; refunds 1 y base de tasa 1/3 (pending_payment excluido). Web integ total: **99**.
- **Unit**: `range.test.ts` (6, validación + default + bounds CR), `csv.test.ts` (3, headers/formato/escape/porcentaje). Web unit total: **92**.
- Typecheck limpio, lint 0 errores. Worker sin cambios (48/7).

**Pendiente**:

- Nada para mergear. Pregunta abierta del spec (ingresos por fecha de pago vs fecha de salida) queda para confirmar con el cliente antes de usar los reportes para conciliación contable real; cambiarla es tocar solo la condición de fecha de `report_revenue`.
- Roadmap pre-prod: ya estaba anotado que reportes financieros conviene validarlos con datos reales en staging.

## 2026-06-07 — Fix: href relativo del export CSV (404 en navegador)

Probando en navegador, el botón "Exportar CSV" tiraba 404: el `href` era relativo (`export?...`) y, como la página `/{locale}/dashboard/reports` no lleva barra final, el navegador lo resolvía contra `/{locale}/dashboard/` → `/{locale}/dashboard/export` (inexistente). Fix: ruta **absoluta con locale** (`/{locale}/dashboard/reports/export?...`). El mismo bug latente existía en el export de reservas del 0008 (`BookingsFilters`, nunca cazado por falta de test de navegador del link) → corregido también con `getLocale()` + ruta absoluta. Lección: los links a route handlers hermanos deben ser absolutos con locale, no relativos (la ruta de la página no tiene trailing slash).
