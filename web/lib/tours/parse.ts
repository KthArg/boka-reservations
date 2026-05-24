import { PricingRowSchema, ScheduleRowSchema } from './types';
import type { PricingRow, ScheduleRow } from './types';

function parseJsonField<T>(
  raw: FormDataEntryValue | null,
  schema: { parse: (v: unknown) => T[] },
): T[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? schema.parse(parsed) : [];
  } catch {
    return [];
  }
}

export function parsePricing(formData: FormData): PricingRow[] {
  return parseJsonField(formData.get('pricing'), {
    parse: (v) => (v as unknown[]).map((row) => PricingRowSchema.parse(row)),
  });
}

export function parseSchedules(formData: FormData): ScheduleRow[] {
  return parseJsonField(formData.get('schedules'), {
    parse: (v) => (v as unknown[]).map((row) => ScheduleRowSchema.parse(row)),
  });
}

export function parseTourFields(formData: FormData): Record<string, unknown> {
  return {
    slug: formData.get('slug'),
    name_es: formData.get('name_es'),
    name_en: formData.get('name_en'),
    description_es: formData.get('description_es'),
    description_en: formData.get('description_en'),
    difficulty: formData.get('difficulty'),
    duration_minutes: formData.get('duration_minutes'),
    meeting_point_es: formData.get('meeting_point_es'),
    meeting_point_en: formData.get('meeting_point_en'),
    includes_es: formData.get('includes_es'),
    includes_en: formData.get('includes_en'),
    min_participants: formData.get('min_participants'),
    max_capacity: formData.get('max_capacity'),
    cover_image_url: formData.get('cover_image_url'),
    pricing: parsePricing(formData),
    schedules: parseSchedules(formData),
  };
}
