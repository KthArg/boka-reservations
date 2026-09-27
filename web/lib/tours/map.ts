import type { PricingRow, ScheduleRow, TourFormData } from './types';
import type { TablesInsert } from '@/types/database';

// Mapeo de filas del formulario a payloads de insert/upsert. Vive aparte de `actions.ts`
// (que es `'use server'` y solo puede exportar funciones async) para poder unit-testearlo.
//
// Para filas nuevas el `id` viene undefined. NO incluir la propiedad `id` en ese caso: si se
// pasa `id: undefined`, supabase-js lo manda como `id: null` (toma Object.keys, que incluye la
// clave aunque el valor sea undefined) y viola el NOT NULL del PK (la columna tiene DEFAULT
// gen_random_uuid()). Solo se incluye `id` para filas existentes (upsert en updateTour).

/**
 * Columnas de `tours` que salen del formulario. `cover_image_url` es lo único que llega como
 * `undefined` cuando se vacía, y supabase-js omite las claves undefined del update: el campo se
 * quedaría con el valor viejo. `charge_lead_hours` ya sale como null del schema (.default(null)).
 */
export function mapTourColumns(
  fields: Omit<TourFormData, 'pricing' | 'schedules'>,
): TablesInsert<'tours'> {
  return { ...fields, cover_image_url: fields.cover_image_url ?? null };
}

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
