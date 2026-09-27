import { describe, it, expect } from 'vitest';
import { mapPricing, mapSchedules, mapTourColumns } from '@/lib/tours/map';
import { TicketType, TourDifficulty } from '@shared/constants/enums';
import { ChargeTiming } from '@shared/constants/tours';

const TOUR_ID = '11111111-1111-1111-1111-111111111111';
const ROW_ID = '22222222-2222-2222-2222-222222222222';

describe('mapPricing', () => {
  it('omite la clave id en filas nuevas (sin id) para que aplique el DEFAULT del PK', () => {
    const [row] = mapPricing(
      [
        {
          ticket_type: TicketType.Adult,
          price_usd: 70,
          valid_from: null,
          valid_until: null,
          active: true,
        },
      ],
      TOUR_ID,
    );
    // Clave del fix: 'id' NO debe estar presente (no `id: null`, que rompería el NOT NULL del PK).
    expect('id' in row).toBe(false);
    expect(row.tour_id).toBe(TOUR_ID);
    expect(row.valid_from).toBeNull();
    expect(row.valid_until).toBeNull();
  });

  it('conserva el id en filas existentes (para el upsert de updateTour)', () => {
    const [row] = mapPricing(
      [{ id: ROW_ID, ticket_type: TicketType.Adult, price_usd: 70, active: true }],
      TOUR_ID,
    );
    expect(row).toHaveProperty('id', ROW_ID);
  });
});

describe('mapSchedules', () => {
  it('omite la clave id en filas nuevas', () => {
    const [row] = mapSchedules(
      [{ day_of_week: 1, start_time: '08:00', capacity: 10, active: true }],
      TOUR_ID,
    );
    expect('id' in row).toBe(false);
    expect(row.tour_id).toBe(TOUR_ID);
  });

  it('conserva el id en filas existentes', () => {
    const [row] = mapSchedules(
      [{ id: ROW_ID, day_of_week: 1, start_time: '08:00', capacity: 10, active: true }],
      TOUR_ID,
    );
    expect(row).toHaveProperty('id', ROW_ID);
  });
});

describe('mapTourColumns', () => {
  const FIELDS = {
    slug: 'volcan-arenal',
    name_es: 'Volcán Arenal',
    name_en: 'Arenal Volcano',
    description_es: 'd',
    description_en: 'd',
    difficulty: TourDifficulty.Easy,
    duration_minutes: 120,
    meeting_point_es: 'P',
    meeting_point_en: 'P',
    includes_es: 'g',
    includes_en: 'g',
    min_participants: 4,
    max_capacity: 12,
    auto_cancel_below_minimum: false,
    charge_timing: ChargeTiming.BeforeDeparture,
    charge_lead_hours: null,
    cover_image_url: null,
  };

  it('manda null cuando el tour no fija su propio plazo de cobro ni portada', () => {
    // Act
    const row = mapTourColumns({ ...FIELDS, cover_image_url: undefined });

    // Assert: con undefined supabase-js omitiría la columna y el update dejaría el valor viejo.
    expect(row.charge_lead_hours).toBeNull();
    expect(row.cover_image_url).toBeNull();
  });

  it('conserva el plazo propio del tour', () => {
    // Act
    const row = mapTourColumns({ ...FIELDS, charge_lead_hours: 12 });

    // Assert
    expect(row.charge_lead_hours).toBe(12);
    expect(row.charge_timing).toBe(ChargeTiming.BeforeDeparture);
  });
});
