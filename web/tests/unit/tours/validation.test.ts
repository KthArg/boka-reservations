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
    const rows = [row(), row({ season_start: '12-01', season_end: '04-30', season_label: 'alta' })];
    expect(detectPricingOverlaps(rows)).toHaveLength(0);
  });

  it('detecta solapamiento entre dos temporadas del mismo tipo', () => {
    const rows = [
      row({ season_start: '12-01', season_end: '04-30', season_label: 'alta' }),
      row({ season_start: '01-01', season_end: '06-30', season_label: 'pico' }),
    ];
    expect(detectPricingOverlaps(rows)).toHaveLength(1);
  });

  it('no detecta solapamiento entre temporadas que no se tocan', () => {
    const rows = [
      row({ season_start: '06-01', season_end: '08-31', season_label: 'baja' }),
      row({ season_start: '12-01', season_end: '04-30', season_label: 'alta' }),
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
  it('PricingRowSchema convierte season_start/season_end "" en null (precio base)', () => {
    const parsed = PricingRowSchema.parse({
      ticket_type: TicketType.Adult,
      price_usd: 70,
      season_start: '',
      season_end: '',
      active: true,
    });
    expect(parsed.season_start).toBeNull();
    expect(parsed.season_end).toBeNull();
  });

  it('PricingRowSchema preserva el día-mes de una temporada', () => {
    const parsed = PricingRowSchema.parse({
      ticket_type: TicketType.Adult,
      price_usd: 70,
      season_label: 'alta',
      season_start: '12-15',
      season_end: '04-30',
      active: true,
    });
    expect(parsed.season_start).toBe('12-15');
    expect(parsed.season_end).toBe('04-30');
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

describe('precio y capacidad vacíos no pasan como 0', () => {
  it('PricingRowSchema rechaza un precio null (NaN en el formulario)', () => {
    const parsed = PricingRowSchema.safeParse({ ticket_type: TicketType.Adult, price_usd: null });
    expect(parsed.success).toBe(false);
  });

  it('ScheduleRowSchema rechaza una capacidad null', () => {
    const parsed = ScheduleRowSchema.safeParse({
      day_of_week: 1,
      start_time: '08:00',
      capacity: null,
    });
    expect(parsed.success).toBe(false);
  });
});
