import { z } from 'zod';
import { UserRole, TourStatus, TicketType, TourDifficulty } from './constants/enums';

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
  full_name: z.string().min(1).max(120),
  phone: z.string().nullable(),
  active: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

const LocaleSchema = z.enum(['es', 'en']);
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

// Alta de usuario interno (spec 0010). El teléfono es obligatorio para guías
// (constraint guide_requires_phone de 0002); opcional para admin/staff.
export const UserCreateSchema = z
  .object({
    email: z.string().email('email-invalid').max(255),
    full_name: z.string().trim().min(1, 'full-name-required').max(120, 'full-name-too-long'),
    role: z.nativeEnum(UserRole),
    phone: z.preprocess(emptyToNull, z.string().trim().min(1).max(40).nullable()),
    locale: LocaleSchema,
  })
  .refine((d) => d.role !== UserRole.Guide || d.phone !== null, {
    message: 'phone-required-for-guide',
    path: ['phone'],
  });

export type UserCreateInput = z.infer<typeof UserCreateSchema>;

// Edición de usuario interno (rol y email son inmutables — ver spec 0010 §3).
export const UserUpdateSchema = z.object({
  full_name: z.string().trim().min(1, 'full-name-required').max(120, 'full-name-too-long'),
  phone: z.preprocess(emptyToNull, z.string().trim().min(1).max(40).nullable()),
  locale: LocaleSchema,
});

export type UserUpdateInput = z.infer<typeof UserUpdateSchema>;

export const TourSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).max(100),
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  description_es: z.string().min(1),
  description_en: z.string().min(1),
  difficulty: z.nativeEnum(TourDifficulty),
  duration_minutes: z.number().int().positive(),
  meeting_point_es: z.string().min(1),
  meeting_point_en: z.string().min(1),
  includes_es: z.string().min(1),
  includes_en: z.string().min(1),
  min_participants: z.number().int().min(1),
  max_capacity: z.number().int().positive(),
  cover_image_url: z.string().url().nullable(),
  status: z.nativeEnum(TourStatus),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const TourPricingSchema = z.object({
  id: z.string().uuid(),
  tour_id: z.string().uuid(),
  ticket_type: z.nativeEnum(TicketType),
  price_usd: z.number().nonnegative(),
  season_label: z.string().nullable(),
  valid_from: z.coerce.date().nullable(),
  valid_until: z.coerce.date().nullable(),
  active: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const TourScheduleSchema = z.object({
  id: z.string().uuid(),
  tour_id: z.string().uuid(),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  capacity: z.number().int().positive(),
  valid_from: z.coerce.date(),
  valid_until: z.coerce.date().nullable(),
  active: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
