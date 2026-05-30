# Changelog — 0008 Panel de reservas y check-in

Spec: [0008-panel-reservas-checkin.md](./0008-panel-reservas-checkin.md)
Rama: feat/0008-panel-reservas-checkin

## 2026-05-30 — Implementación completa, lista para PR

**Hecho**:

- Migración `20260530000014`: columnas `checked_in_at`/`checked_in_by` en `bookings`, índice parcial, y políticas RLS `SELECT` para `authenticated` (admin/staff) sobre `bookings`, `payments` y `notifications`.
- Enums `BookingStatus`/`PaymentStatus` en `shared/constants/enums.ts` (antes solo existían como string literals en `database.ts`); constantes del panel en `shared/constants/bookings.ts`.
- Capa de lectura en `lib/booking/`: `repository.ts` (lista paginada con embedding + helpers de filtro reusables), `export-repository.ts`, `admin-detail.ts` (detalle + vista Hoy con agregados), `admin-filters.ts` (parseo de query params, validación de rango, serialización), `today-range.ts` (límites/formato en TZ del operador UTC-6), `csv.ts`.
- `checkin-action.ts`: Server Action `toggleCheckIn` idempotente (UPDATE condicionado a `checked_in_at IS NULL`), guard admin/staff vía `requireAnyRole`, escritura con service client.
- Route handler `dashboard/bookings/export` (CSV con rango obligatorio ≤1 año).
- UI: páginas lista/detalle/hoy, `CheckInButton` (client) con confirmación, filtros server-rendered, paginación por query params. Nav + i18n ES/EN.
- Tests: unit nuevos (filtros, CSV, TZ) + 4 integración (embedding del listado, idempotencia, revert, RLS anon). Suites completas verdes: **55 unit, 58 integración**. Lint y typecheck (web + worker) limpios.

**Por qué / decisiones**:

- **Check-in a nivel reserva** (no tabla de tickets): `bookings` solo guarda conteos por tipo, no hay datos por-asistente. Dos columnas alcanzan.
- **Sin `audit_logs`**: se difiere al spec de refunds/cancelaciones donde el historial importa de verdad (evita scope creep).
- **`FilterBuilder` como alias `any` documentado** en `repository.ts`: el cliente tipado con `Database` no acepta filtros sobre columnas embebidas (`tour_instances.tour_id`) en `keyof Row`. Se intentó una interfaz estructural (`extends PromiseLike` + métodos) pero no compilaba en los call sites; se optó por `type FilterBuilder = any` con eslint-disable (patrón ya presente en el repo) re-tipando los resultados vía `RawListRow`/`RawExportRow` al mapear.
- **Export con rango obligatorio ≤1 año** en vez de cap por filas: acota por intención del usuario y elimina el modo de falla "exportar todo".
- El test de integración **no importa `listBookingsForAdmin`** (depende de `next/headers`, server-only); replica el `LIST_SELECT` con el service client para validar el embedding de PostgREST.

**Notas para retomar**:

- La política RLS de lectura para staff depende del claim `user_role` del JWT (auth hook, migración 0007), que localmente se registra a mano en Studio. Por eso la cobertura positiva ("staff lee") no se testeó vía JWT vivo; sí se cubre la denegación a anon (no depende del hook). Verificar el hook en staging antes de confiar en la lectura autenticada del panel.

**Pendiente**:

- Nada — feature lista para PR.
