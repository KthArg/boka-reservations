import { TicketType, TourDifficulty } from '@shared/constants/enums';
import type { PricingRow, ScheduleRow, TourBasicValues, TourWithDetails } from '@/lib/tours/types';

// Valores iniciales del formulario de tours a partir del tour guardado (o vacíos al crear).

export function toPricingRows(pricing: TourWithDetails['pricing']): PricingRow[] {
  return pricing.map((p) => ({
    id: p.id,
    ticket_type: p.ticket_type as TicketType,
    price_usd: Number(p.price_usd),
    season_label: p.season_label,
    season_start: p.season_start,
    season_end: p.season_end,
    active: p.active,
  }));
}

export function toScheduleRows(schedules: TourWithDetails['schedules']): ScheduleRow[] {
  return schedules.map((s) => ({
    id: s.id,
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    capacity: s.capacity,
    valid_from: s.valid_from,
    valid_until: s.valid_until,
    active: s.active,
  }));
}

export function toBasicValues(tour?: TourWithDetails): TourBasicValues {
  return {
    name_es: tour?.name_es ?? '',
    name_en: tour?.name_en ?? '',
    description_es: tour?.description_es ?? '',
    description_en: tour?.description_en ?? '',
    meeting_point_es: tour?.meeting_point_es ?? '',
    meeting_point_en: tour?.meeting_point_en ?? '',
    includes_es: tour?.includes_es ?? '',
    includes_en: tour?.includes_en ?? '',
    difficulty: tour?.difficulty ?? TourDifficulty.Easy,
    duration_minutes: tour ? String(tour.duration_minutes) : '',
    min_participants: tour ? String(tour.min_participants) : '',
    max_capacity: tour ? String(tour.max_capacity) : '',
    slug: tour?.slug ?? '',
    cover_image_url: tour?.cover_image_url ?? '',
  };
}
