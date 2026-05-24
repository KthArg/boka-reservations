# Changelog — 0003 Gestión de tours desde el panel admin

Spec: [0003-gestion-tours-panel-admin.md](./0003-gestion-tours-panel-admin.md)
Rama: feat/0003-gestion-tours-panel-admin

## 2026-05-22 19:05 — Implementación completa, lista para PR

**Hecho**:

- Creé `lib/tours/types.ts` con los schemas Zod (`PricingRowSchema`, `ScheduleRowSchema`, `TourFormSchema`) y tipos derivados (`PricingRow`, `ScheduleRow`, `TourFormData`, `TourWithDetails`, `TourListItem`, `FieldErrors`, `ActionResult`).
- Creé `lib/tours/validation.ts` con `slugify` (normalización NFD + ñ→n + limpieza) y `detectPricingOverlaps` (compara filas activas del mismo ticket_type por tipo de solapamiento).
- Creé `lib/tours/repository.ts` con `listTours`, `getTourWithDetails` y `slugExists`.
- Creé `lib/tours/parse.ts` con helpers de parsing de FormData (extraído para cumplir el límite de 150 líneas).
- Creé `lib/tours/actions.ts` con las cuatro server actions: `createTour`, `updateTour`, `archiveTour`, `reactivateTour`.
- Creé los componentes `PricingEditor`, `ScheduleEditor`, `TourBasicInfoSection` y `TourForm` con sus CSS Modules hermanos.
- Creé las páginas `/admin/tours` (lista), `/admin/tours/new` (creación) y `/admin/tours/[id]/edit` (edición con botón archive/reactivate fuera del form).
- Actualicé el admin layout para reemplazar el placeholder por un nav link a Tours.
- Actualicé los locales ES y EN con el namespace `tours` completo (~60 claves).
- Agregué `--text-xs: 0.75rem` al `globals.css`.
- 15 unit tests (validation.test.ts): todos pasan. 6 integration tests (tours.test.ts): requieren `supabase start`.

**Por qué / decisiones**:

- Los datos de precios y horarios se serializan como JSON en `<input type="hidden">` porque son arrays de objetos que no mapean limpiamente a FormData plano. El cliente mantiene el estado en `useState`, serializa a JSON al hacer submit, y el server action parsea el JSON.
- El update de pricing/schedules usa `upsert`: filas con `id` existente se actualizan, filas sin `id` se insertan. El JSON.stringify elimina `undefined` automáticamente, así que `id: p.id` pasa como `undefined` cuando la fila es nueva (→ INSERT) y como string UUID cuando ya existe (→ UPDATE).
- `TourBasicInfoSection` se extrajo de `TourForm` para mantener ambos archivos bajo el límite de 150 líneas.
- `lib/tours/parse.ts` se extrajo de `actions.ts` por la misma razón.
- `archiveTour`/`reactivateTour` usan `revalidatePath('/', 'layout')` en lugar del path específico porque el path real incluye el locale dinámico (`/es/tours`, `/en/tours`) y Next.js necesita el path exacto o el layout raíz para invalidar correctamente.
- Se corrigió un magic string en `actions.ts`: `'archived'`/`'active'` → `TourStatus.Archived`/`TourStatus.Active`.

**Pendiente**:

- Nada — feature lista para PR.
