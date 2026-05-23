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
