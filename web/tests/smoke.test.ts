import { describe, it, expect } from 'vitest';
import { UserRole, Currency } from '@shared/constants/enums';
import { TourSchema } from '@shared/schemas';

describe('smoke test — shared types y schemas', () => {
  it('UserRole tiene los tres roles del sistema', () => {
    expect(UserRole.Admin).toBe('admin');
    expect(UserRole.Staff).toBe('staff');
    expect(UserRole.Guide).toBe('guide');
  });

  it('Currency tiene USD y CRC', () => {
    expect(Currency.USD).toBe('USD');
    expect(Currency.CRC).toBe('CRC');
  });

  it('TourSchema rechaza un tour sin nombre bilingüe', () => {
    const result = TourSchema.safeParse({ name: 'solo string' });
    expect(result.success).toBe(false);
  });

  it('TourSchema acepta un tour válido', () => {
    const validTour = {
      id: '00000000-0000-7000-8000-000000000001',
      slug: 'birdwatching-monteverde',
      name: { es: 'Birdwatching Monteverde', en: 'Birdwatching Monteverde' },
      description: { es: 'Descripción', en: 'Description' },
      duration_minutes: 240,
      max_capacity: 12,
      meeting_point: { es: 'Portón principal', en: 'Main gate' },
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const result = TourSchema.safeParse(validTour);
    expect(result.success).toBe(true);
  });
});
