import { describe, expect, it } from 'vitest';
import { detectPricingOverlaps } from '@/lib/tours/validation';
import { TicketType } from '@shared/constants/enums';
import type { PricingRow } from '@/lib/tours/types';

// Semántica nueva del solape (spec 0028, B1), alineada con los constraints de …041:
// bordes INCLUSIVOS entre temporadas, temporadas con un solo límite = abiertas, y
// códigos de error (no mensajes) para i18n.

function row(over: Partial<PricingRow>): PricingRow {
  return {
    ticket_type: TicketType.Adult,
    price_usd: 50,
    active: true,
    valid_from: null,
    valid_until: null,
    ...over,
  } as PricingRow;
}

describe('detectPricingOverlaps — bordes y aperturas (spec 0028)', () => {
  it('temporadas adyacentes que COMPARTEN el día borde solapan (bordes inclusivos)', () => {
    const errors = detectPricingOverlaps([
      row({ valid_from: '2026-01-01', valid_until: '2026-01-31' }),
      row({ valid_from: '2026-01-31', valid_until: '2026-02-28' }),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('tour_pricing_overlap');
  });

  it('temporadas adyacentes SIN compartir el borde no solapan', () => {
    const errors = detectPricingOverlaps([
      row({ valid_from: '2026-01-01', valid_until: '2026-01-31' }),
      row({ valid_from: '2026-02-01', valid_until: '2026-02-28' }),
    ]);
    expect(errors).toHaveLength(0);
  });

  it('una temporada abierta (solo valid_from) solapa con otra posterior', () => {
    const errors = detectPricingOverlaps([
      row({ valid_from: '2026-01-01', valid_until: null }),
      row({ valid_from: '2026-06-01', valid_until: '2026-06-30' }),
    ]);
    expect(errors).toHaveLength(1);
  });

  it('base + temporada conviven (la prioridad la resuelve selectEffectivePricing)', () => {
    const errors = detectPricingOverlaps([
      row({}),
      row({ valid_from: '2026-01-01', valid_until: '2026-01-31' }),
    ]);
    expect(errors).toHaveLength(0);
  });

  it('dos precios base del mismo tipo devuelven su código propio', () => {
    const errors = detectPricingOverlaps([row({}), row({ price_usd: 45 })]);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('tour_base_price_duplicate');
  });

  it('las filas inactivas no cuentan', () => {
    const errors = detectPricingOverlaps([row({}), row({ active: false })]);
    expect(errors).toHaveLength(0);
  });
});
