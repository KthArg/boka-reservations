import { describe, expect, it } from 'vitest';
import { toCardInput, type CardFormValues } from './card-input';

const VALID: CardFormValues = {
  number: '4242 4242 4242 4242',
  expMonth: '12',
  expYear: '2030',
  cvv: '123',
  holderName: '  Ana Pérez ',
};

describe('toCardInput', () => {
  it('normalizes a valid card', () => {
    // Act
    const card = toCardInput(VALID);

    // Assert
    expect(card).toEqual({
      number: '4242424242424242',
      expMonth: 12,
      expYear: 2030,
      cvv: '123',
      holderName: 'Ana Pérez',
    });
  });

  it('expands a two-digit year', () => {
    // Act
    const card = toCardInput({ ...VALID, expYear: '31' });

    // Assert
    expect(card?.expYear).toBe(2031);
  });

  it.each([
    ['a short number', { number: '4242' }],
    ['letters in the number', { number: '4242abcd42424242' }],
    ['month 0', { expMonth: '0' }],
    ['month 13', { expMonth: '13' }],
    ['an empty year', { expYear: '' }],
    ['a three-digit year', { expYear: '203' }],
    ['a non-numeric month', { expMonth: '1a' }],
    ['a two-digit cvv', { cvv: '12' }],
    ['an empty holder name', { holderName: '   ' }],
    ['a holder name over 120 characters', { holderName: 'a'.repeat(121) }],
  ])('rejects %s', (_case, change) => {
    // Act
    const card = toCardInput({ ...VALID, ...change });

    // Assert
    expect(card).toBeNull();
  });
});
