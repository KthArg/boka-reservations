import { z } from 'zod';
import { UserRole, Currency } from './constants/enums';

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
  full_name: z.string().min(1).max(120),
  is_active: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const TourSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).max(100),
  name: z.object({ es: z.string(), en: z.string() }),
  description: z.object({ es: z.string(), en: z.string() }),
  duration_minutes: z.number().int().positive(),
  max_capacity: z.number().int().positive(),
  meeting_point: z.object({ es: z.string(), en: z.string() }),
  is_active: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const TourPricingSchema = z.object({
  id: z.string().uuid(),
  tour_id: z.string().uuid(),
  label: z.object({ es: z.string(), en: z.string() }),
  amount_cents: z.number().int().nonnegative(),
  currency: z.nativeEnum(Currency),
  valid_from: z.coerce.date(),
  valid_until: z.coerce.date().nullable(),
});

export const TourScheduleSchema = z.object({
  id: z.string().uuid(),
  tour_id: z.string().uuid(),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  is_active: z.boolean(),
});
