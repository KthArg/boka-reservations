import type { z } from 'zod';
import type { UserSchema, TourSchema, TourPricingSchema, TourScheduleSchema } from './schemas';

export type User = z.infer<typeof UserSchema>;
export type Tour = z.infer<typeof TourSchema>;
export type TourPricing = z.infer<typeof TourPricingSchema>;
export type TourSchedule = z.infer<typeof TourScheduleSchema>;
