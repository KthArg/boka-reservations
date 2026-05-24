import { describe, it, expect } from 'vitest';
import {
  UserRole,
  Currency,
  TourStatus,
  TicketType,
  TourDifficulty,
} from '@shared/constants/enums';
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

  it('enums de Etapa 3 existen', () => {
    expect(TourStatus.Active).toBe('active');
    expect(TicketType.Adult).toBe('adult');
    expect(TourDifficulty.Easy).toBe('easy');
  });

  it('TourSchema rechaza un tour sin campos requeridos', () => {
    const result = TourSchema.safeParse({ slug: 'solo-slug' });
    expect(result.success).toBe(false);
  });

  it('TourSchema acepta un tour válido con columnas planas', () => {
    const validTour = {
      id: '00000000-0000-7000-8000-000000000001',
      slug: 'birdwatching-monteverde',
      name_es: 'Birdwatching Monteverde',
      name_en: 'Birdwatching Monteverde',
      description_es: 'Descripción',
      description_en: 'Description',
      difficulty: 'easy',
      duration_minutes: 240,
      meeting_point_es: 'Portón principal',
      meeting_point_en: 'Main gate',
      includes_es: 'Guía',
      includes_en: 'Guide',
      min_participants: 1,
      max_capacity: 12,
      cover_image_url: null,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const result = TourSchema.safeParse(validTour);
    expect(result.success).toBe(true);
  });
});
