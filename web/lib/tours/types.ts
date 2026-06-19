import { z } from 'zod';
import { TourDifficulty, TicketType } from '@shared/constants/enums';
import type { Tables } from '@/types/database';

// Los <input type="date"> vacíos llegan como '' en el FormData; las columnas `date` de Postgres
// rechazan '' con 22007. Normalizamos '' en origen. Para columnas nullable (precios y
// valid_until) → null; para tour_schedules.valid_from (NOT NULL DEFAULT current_date) →
// undefined, que se omite del insert y aplica el default. Esto también corrige la detección de
// solapamientos (que trata null como "precio base"; antes veía '' como una fecha real).
const preprocess = (v: unknown) => (v === '' ? null : v);
const optionalDate = z.preprocess(preprocess, z.string().nullable().optional());
const optionalDateOmit = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

export const PricingRowSchema = z.object({
  id: z.string().uuid().optional(),
  ticket_type: z.nativeEnum(TicketType),
  price_usd: z.coerce.number().min(0),
  season_label: z.string().nullable().optional(),
  valid_from: optionalDate,
  valid_until: optionalDate,
  active: z.boolean().default(true),
});

export const ScheduleRowSchema = z.object({
  id: z.string().uuid().optional(),
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  capacity: z.coerce.number().int().positive(),
  valid_from: optionalDateOmit,
  valid_until: optionalDate,
  active: z.boolean().default(true),
});

export const TourFormSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, 'Solo letras minúsculas, números y guiones'),
    name_es: z.string().min(1).max(120),
    name_en: z.string().min(1).max(120),
    description_es: z.string().min(1),
    description_en: z.string().min(1),
    difficulty: z.nativeEnum(TourDifficulty),
    duration_minutes: z.coerce.number().int().positive(),
    meeting_point_es: z.string().min(1),
    meeting_point_en: z.string().min(1),
    includes_es: z.string().min(1),
    includes_en: z.string().min(1),
    min_participants: z.coerce.number().int().min(1),
    max_capacity: z.coerce.number().int().positive(),
    cover_image_url: z.preprocess(preprocess, z.string().url().nullable().optional()),
    pricing: z.array(PricingRowSchema),
    schedules: z.array(ScheduleRowSchema),
  })
  .refine((d) => d.max_capacity >= d.min_participants, {
    message: 'La capacidad máxima debe ser mayor o igual al mínimo de participantes',
    path: ['max_capacity'],
  });

export type PricingRow = z.infer<typeof PricingRowSchema>;
export type ScheduleRow = z.infer<typeof ScheduleRowSchema>;
export type TourFormData = z.infer<typeof TourFormSchema>;

export type TourWithDetails = Tables<'tours'> & {
  pricing: Tables<'tour_pricing'>[];
  schedules: Tables<'tour_schedules'>[];
};

export type TourListItem = Tables<'tours'> & { activeSchedulesCount: number };

export type FieldErrors = { _form?: string[] } & Partial<Record<string, string[]>>;

export type ActionResult = { success: true; id: string } | { success: false; errors: FieldErrors };
