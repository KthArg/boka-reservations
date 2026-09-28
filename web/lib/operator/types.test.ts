// Compuerta de venta por identidad del operador (spec 0034): sin los datos obligatorios no se vende.
import { describe, expect, it } from 'vitest';
import { isOperatorIdentityComplete, type OperatorIdentity } from './types';

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
