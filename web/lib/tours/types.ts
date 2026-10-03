import { z } from 'zod';
import { isValidMonthDay } from '@/lib/pricing/season';
import { isTourImageUrl } from './cover-image';
import { TourDifficulty, TicketType } from '@shared/constants/enums';
import {
  CHARGE_LEAD_HOURS_MAX,
  CHARGE_LEAD_HOURS_MIN,
  CHILD_AGE_MAX,
  ChargeTiming,
  TourActionError,
} from '@shared/constants/tours';
import type { Tables } from '@/types/database';

// Los <input type="date"> vacíos llegan como '' en el FormData; las columnas `date` de Postgres
// rechazan '' con 22007. Normalizamos '' en origen. Para columnas nullable (precios y
// valid_until) → null; para tour_schedules.valid_from (NOT NULL DEFAULT current_date) →
// undefined, que se omite del insert y aplica el default. Esto también corrige la detección de
// solapamientos (que trata null como "precio base"; antes veía '' como una fecha real).
const preprocess = (v: unknown) => (v === '' ? null : v);
const optionalDate = z.preprocess(preprocess, z.string().nullable().optional());
// Día-mes 'MM-DD' de una temporada (spec 0040); vacío es null (precio base).
const optionalMonthDay = z.preprocess(
  preprocess,
  z.string().refine(isValidMonthDay, 'tour_season_range_invalid').nullable().optional(),
);
const optionalDateOmit = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

// Un precio o una capacidad vacíos llegan como null (NaN en JSON): z.coerce los convertiría en 0 y
// se guardaría un precio de 0 sin que nadie lo escribiera. null pasa a undefined y el campo falla.
const requiredNumber = (v: unknown) => (v === null ? undefined : v);

export const PricingRowSchema = z.object({
  id: z.string().uuid().optional(),
  ticket_type: z.nativeEnum(TicketType),
  price_usd: z.preprocess(requiredNumber, z.coerce.number().min(0)),
  season_label: z.preprocess(preprocess, z.string().trim().nullable().optional()),
  // Temporada que se repite cada año (spec 0040): 'MM-DD', las dos o ninguna (precio base).
  season_start: optionalMonthDay,
  season_end: optionalMonthDay,
  active: z.boolean().default(true),
});

export const ScheduleRowSchema = z.object({
  id: z.string().uuid().optional(),
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  capacity: z.preprocess(requiredNumber, z.coerce.number().int().positive()),
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
    // Spec 0034: lo que la cláusula 3 de los términos promete publicar de cada tour.
    excludes_es: z.string().trim().min(1),
    excludes_en: z.string().trim().min(1),
    requirements_es: z.string().trim().min(1),
    requirements_en: z.string().trim().min(1),
    child_age_min: z.preprocess(
      preprocess,
      z.coerce.number().int().min(0).max(CHILD_AGE_MAX).nullable(),
    ),
    child_age_max: z.preprocess(
      preprocess,
      z.coerce.number().int().min(0).max(CHILD_AGE_MAX).nullable(),
    ),
    min_participants: z.coerce.number().int().min(1),
    max_capacity: z.coerce.number().int().positive(),
    charge_timing: z.nativeEnum(ChargeTiming).default(ChargeTiming.BeforeDeparture),
    // Vacío o ausente (el campo solo se muestra con "antes de la salida") → null, que en DB
    // significa "usar business_settings.default_charge_lead_hours".
    charge_lead_hours: z.preprocess(
      preprocess,
      z.coerce
        .number()
        .int()
        .min(CHARGE_LEAD_HOURS_MIN)
        .max(CHARGE_LEAD_HOURS_MAX)
        .nullable()
        .default(null),
    ),
    // Solo archivos del bucket propio (spec 0036): otra URL le daría la IP del visitante a un tercero.
    cover_image_url: z.preprocess(
      preprocess,
      z
        .string()
        .refine((url) => isTourImageUrl(url), { message: TourActionError.CoverImageInvalid })
        .nullable()
        .optional(),
    ),
    pricing: z.array(PricingRowSchema),
    schedules: z.array(ScheduleRowSchema),
  })
  .refine((d) => d.max_capacity >= d.min_participants, {
    message: 'La capacidad máxima debe ser mayor o igual al mínimo de participantes',
    path: ['max_capacity'],
  })
  // Las dos edades o ninguna (tours_child_ages_check, …048).
  .refine((d) => (d.child_age_min === null) === (d.child_age_max === null), {
    message: TourActionError.ChildAgesRequired,
    path: ['child_age_min'],
  })
  // Con tiquete de niño, los términos remiten a las edades publicadas en la página del tour.
  .refine(
    (d) =>
      !d.pricing.some((p) => p.ticket_type === TicketType.Child) ||
      (d.child_age_min !== null && d.child_age_max !== null),
    { message: TourActionError.ChildAgesRequired, path: ['child_age_min'] },
  )
  .refine(
    (d) =>
      d.child_age_min === null || d.child_age_max === null || d.child_age_min <= d.child_age_max,
    { message: TourActionError.ChildAgesInvalid, path: ['child_age_max'] },
  );

export type PricingRow = z.infer<typeof PricingRowSchema>;
export type ScheduleRow = z.infer<typeof ScheduleRowSchema>;
export type TourFormData = z.infer<typeof TourFormSchema>;

export type TourWithDetails = Tables<'tours'> & {
  pricing: Tables<'tour_pricing'>[];
  schedules: Tables<'tour_schedules'>[];
};

export type TourListItem = Tables<'tours'> & { activeSchedulesCount: number };

// Valores (como strings de formulario) de los campos básicos del tour. Se manejan como estado
// controlado en TourForm para que React 19 no los borre al hacer form.reset() tras la action.
export type TourBasicValues = {
  name_es: string;
  name_en: string;
  description_es: string;
  description_en: string;
  meeting_point_es: string;
  meeting_point_en: string;
  includes_es: string;
  includes_en: string;
  difficulty: string;
  duration_minutes: string;
  min_participants: string;
  max_capacity: string;
  slug: string;
  cover_image_url: string;
};

export type FieldErrors = { _form?: string[] } & Partial<Record<string, string[]>>;

/**
 * Resultado de crear o editar un tour. Al editar, `withdrawn`/`kept` cuentan las salidas fuera de
 * vigencia que se retiraron y las que quedaron por tener reservas (spec 0044); con `kept > 0` la
 * acción no redirige, para que el admin lo vea.
 */
export type ActionResult =
  | { success: true; id: string; withdrawn?: number; kept?: number }
  | { success: false; errors: FieldErrors };
