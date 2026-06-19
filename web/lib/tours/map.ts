import type { PricingRow, ScheduleRow } from './types';

// Mapeo de filas del formulario a payloads de insert/upsert. Vive aparte de `actions.ts`
// (que es `'use server'` y solo puede exportar funciones async) para poder unit-testearlo.
//
// Para filas nuevas el `id` viene undefined. NO incluir la propiedad `id` en ese caso: si se
// pasa `id: undefined`, supabase-js lo manda como `id: null` (toma Object.keys, que incluye la
// clave aunque el valor sea undefined) y viola el NOT NULL del PK (la columna tiene DEFAULT
// gen_random_uuid()). Solo se incluye `id` para filas existentes (upsert en updateTour).

export function mapPricing(pricing: PricingRow[], tourId: string) {
  return pricing.map((p) => ({
    ...(p.id ? { id: p.id } : {}),
    tour_id: tourId,
    ticket_type: p.ticket_type,
    price_usd: p.price_usd,
    season_label: p.season_label ?? null,
    valid_from: p.valid_from ?? null,
    valid_until: p.valid_until ?? null,
    active: p.active,
  }));
}

export function mapSchedules(schedules: ScheduleRow[], tourId: string) {
  return schedules.map((s) => ({
    ...(s.id ? { id: s.id } : {}),
    tour_id: tourId,
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    capacity: s.capacity,
    valid_from: s.valid_from,
    valid_until: s.valid_until ?? null,
    active: s.active,
  }));
}
