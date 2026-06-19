import { describe, it, expect } from 'vitest';
import { slugify, detectPricingOverlaps } from '@/lib/tours/validation';
import { TicketType } from '@shared/constants/enums';
import type { PricingRow } from '@/lib/tours/types';
import { PricingRowSchema, ScheduleRowSchema } from '@/lib/tours/types';

describe('slugify', () => {
  it('convierte a minúsculas y reemplaza espacios con guiones', () => {
    expect(slugify('Birdwatching Monteverde')).toBe('birdwatching-monteverde');
  });

  it('elimina caracteres especiales manteniendo letras y números', () => {
    expect(slugify('Tour #1 en San José!')).toBe('tour-1-en-san-jose');
  });

  it('normaliza vocales con tilde', () => {
    expect(slugify('Río Celeste Encantado')).toBe('rio-celeste-encantado');
  });

  it('convierte ñ a n', () => {
    expect(slugify('Montaña Grande')).toBe('montana-grande');
  });

  it('colapsa guiones múltiples consecutivos', () => {
    expect(slugify('hola -- mundo')).toBe('hola-mundo');
  });

  it('recorta espacios al inicio y al final', () => {
    expect(slugify('  tour de prueba  ')).toBe('tour-de-prueba');
  });

  it('devuelve cadena vacía para input vacío', () => {
    expect(slugify('')).toBe('');
  });
});

describe('detectPricingOverlaps', () => {
  const row = (overrides: Partial<PricingRow> = {}): PricingRow => ({
    ticket_type: TicketType.Adult,
    price_usd: 50,
    active: true,
    ...overrides,
  });

  it('sin errores cuando hay una sola fila activa', () => {
    expect(detectPricingOverlaps([row()])).toHaveLength(0);
  });

  it('detecta dos precios base del mismo tipo (sin fechas)', () => {
    expect(detectPricingOverlaps([row(), row()])).toHaveLength(1);
  });

  it('permite precio base + temporada del mismo tipo', () => {
    const rows = [
      row(),
      row({ valid_from: '2026-12-01', valid_until: '2027-04-30', season_label: 'alta' }),
    ];
    expect(detectPricingOverlaps(rows)).toHaveLength(0);
  });

  it('detecta solapamiento entre dos temporadas del mismo tipo', () => {
    const rows = [
      row({ valid_from: '2026-12-01', valid_until: '2027-04-30', season_label: 'alta' }),
      row({ valid_from: '2027-01-01', valid_until: '2027-06-30', season_label: 'pico' }),
    ];
    expect(detectPricingOverlaps(rows)).toHaveLength(1);
  });

  it('no detecta solapamiento entre temporadas que no se tocan', () => {
    const rows = [
      row({ valid_from: '2026-06-01', valid_until: '2026-08-31', season_label: 'baja' }),
      row({ valid_from: '2026-12-01', valid_until: '2027-04-30', season_label: 'alta' }),
    ];
    expect(detectPricingOverlaps(rows)).toHaveLength(0);
  });

  it('ignora filas inactivas al calcular solapamientos', () => {
    expect(detectPricingOverlaps([row({ active: false }), row({ active: false })])).toHaveLength(0);
  });

  it('no detecta solapamiento entre tipos de ticket distintos', () => {
    const rows = [row({ ticket_type: TicketType.Adult }), row({ ticket_type: TicketType.Child })];
    expect(detectPricingOverlaps(rows)).toHaveLength(0);
  });

  it('devuelve lista vacía para input vacío', () => {
    expect(detectPricingOverlaps([])).toHaveLength(0);
  });
});

describe('coerción de fechas vacías a null (fix 22007)', () => {
  it('PricingRowSchema convierte valid_from/valid_until "" en null', () => {
    const parsed = PricingRowSchema.parse({
      ticket_type: TicketType.Adult,
      price_usd: 70,
      valid_from: '',
      valid_until: '',
      active: true,
    });
    expect(parsed.valid_from).toBeNull();
    expect(parsed.valid_until).toBeNull();
  });

  it('PricingRowSchema preserva fechas reales', () => {
    const parsed = PricingRowSchema.parse({
      ticket_type: TicketType.Adult,
      price_usd: 70,
      valid_from: '2026-12-01',
      valid_until: '2027-04-30',
      active: true,
    });
    expect(parsed.valid_from).toBe('2026-12-01');
    expect(parsed.valid_until).toBe('2027-04-30');
  });

  it('ScheduleRowSchema: valid_from "" → undefined (se omite, aplica el default NOT NULL) y valid_until "" → null', () => {
    const parsed = ScheduleRowSchema.parse({
      day_of_week: 1,
      start_time: '08:00',
      capacity: 10,
      valid_from: '',
      valid_until: '',
      active: true,
    });
    expect(parsed.valid_from).toBeUndefined();
    expect(parsed.valid_until).toBeNull();
  });
});
