import { describe, it, expect } from 'vitest';
import { mapPricing, mapSchedules } from '@/lib/tours/map';
import { TicketType } from '@shared/constants/enums';

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
