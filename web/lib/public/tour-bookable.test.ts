// Compuerta de venta por tour (spec 0034): la información que promete la cláusula 3 de los
// términos.
import { describe, expect, it } from 'vitest';
import { isTourBookable } from './tour-bookable';

const TOUR = {
  excludes_es: 'Transporte',
  excludes_en: 'Transport',
  requirements_es: 'Mayores de 6 años',
  requirements_en: 'Ages 6 and up',
  child_age_min: 6,
  child_age_max: 12,
};

const ADULT = { ticket_type: 'adult' };
const CHILD = { ticket_type: 'child' };

describe('isTourBookable', () => {
  it('acepta un tour con toda la información', () => {
    expect(isTourBookable(TOUR, [ADULT, CHILD])).toBe(true);
  });

  it.each(['excludes_es', 'excludes_en', 'requirements_es', 'requirements_en'] as const)(
    'rechaza un tour sin %s',
    (field) => {
      expect(isTourBookable({ ...TOUR, [field]: '   ' }, [ADULT])).toBe(false);
    },
  );

  it('exige las edades del tiquete de niño solo si el tour lo vende', () => {
    const noAges = { ...TOUR, child_age_min: null, child_age_max: null };
    expect(isTourBookable(noAges, [ADULT])).toBe(true);
    expect(isTourBookable(noAges, [ADULT, CHILD])).toBe(false);
  });
});
