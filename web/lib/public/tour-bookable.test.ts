// Compuertas de venta del spec 0034: datos del operador completos y tour con la información que
// promete la cláusula 3 de los términos.
import { describe, expect, it } from 'vitest';
import { isTourBookable } from './tour-bookable';
import { isOperatorIdentityComplete, type OperatorIdentity } from '@/lib/operator/types';

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

const OPERATOR: OperatorIdentity = {
  legalName: 'Boka Verde Tours S.A.',
  taxId: '3-101-123456',
  address: 'San José',
  brand: 'Boka Verde',
  contactEmail: 'hola@bokaverde.cr',
  privacyEmail: 'privacidad@bokaverde.cr',
  phone: '+506 2222-2222',
  hours: 'de lunes a viernes',
  ictDeclaration: '',
  hasLiabilityPolicy: false,
};

describe('isOperatorIdentityComplete', () => {
  it('acepta la identidad completa sin declaratoria del ICT, que es opcional', () => {
    expect(isOperatorIdentityComplete(OPERATOR)).toBe(true);
  });

  it.each([
    'legalName',
    'taxId',
    'address',
    'brand',
    'contactEmail',
    'privacyEmail',
    'phone',
    'hours',
  ] as const)('rechaza la identidad sin %s', (field) => {
    expect(isOperatorIdentityComplete({ ...OPERATOR, [field]: ' ' })).toBe(false);
  });
});
