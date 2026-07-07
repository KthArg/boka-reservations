import { describe, expect, it } from 'vitest';
import { selectEffectivePricing } from './active-filter';

// Prioridad determinista temporada > base (spec 0028, B1): con ambos vigentes el mismo
// día, el checkout cobraba cualquiera de los dos según el orden físico de las filas.
describe('selectEffectivePricing', () => {
  const base = { ticket_type: 'adult', price_usd: 40, valid_from: null, valid_until: null };
  const season = {
    ticket_type: 'adult',
    price_usd: 60,
    valid_from: '2026-12-01',
    valid_until: '2027-01-31',
  };

  it('la temporada SIEMPRE gana sobre el precio base, sin importar el orden', () => {
    expect(selectEffectivePricing([base, season])).toEqual([season]);
    expect(selectEffectivePricing([season, base])).toEqual([season]);
  });

  it('sin temporada vigente, aplica el base', () => {
    expect(selectEffectivePricing([base])).toEqual([base]);
  });

  it('una temporada con un solo límite de fecha también gana sobre el base', () => {
    const openEnded = { ...season, valid_until: null };
    expect(selectEffectivePricing([base, openEnded])).toEqual([openEnded]);
  });

  it('tie-break determinista si coexistieran dos temporadas (defensa sin el EXCLUDE)', () => {
    const early = { ...season, valid_from: '2026-11-01', valid_until: '2027-02-28' };
    // Gana la que empezó más tarde (más específica), sin importar el orden de llegada.
    expect(selectEffectivePricing([early, season])).toEqual([season]);
    expect(selectEffectivePricing([season, early])).toEqual([season]);
  });

  it('resuelve por ticket_type de forma independiente', () => {
    const childBase = { ...base, ticket_type: 'child', price_usd: 20 };
    const result = selectEffectivePricing([base, season, childBase]);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(season);
    expect(result).toContainEqual(childBase);
  });
});
