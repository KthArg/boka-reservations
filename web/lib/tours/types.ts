import { z } from 'zod';
import { TourDifficulty, TicketType } from '@shared/constants/enums';
import type { Tables } from '@/types/database';

export const PricingRowSchema = z.object({
  id: z.string().uuid().optional(),
  ticket_type: z.nativeEnum(TicketType),
  price_usd: z.coerce.number().min(0),
  season_label: z.string().nullable().optional(),
  valid_from: z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
  active: z.boolean().default(true),
});

export const ScheduleRowSchema = z.object({
  id: z.string().uuid().optional(),
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  capacity: z.coerce.number().int().positive(),
  valid_from: z.string().optional(),
  valid_until: z.string().nullable().optional(),
  active: z.boolean().default(true),
});

const preprocess = (v: unknown) => (v === '' ? null : v);

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
