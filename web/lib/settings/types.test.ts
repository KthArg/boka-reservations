import { describe, expect, it } from 'vitest';
import { BusinessSettingsFormSchema } from './types';

// El formulario manda strings: los dos campos coercen a entero y comparten el rango 1..720 de
// sus CHECK de DB (specs 0029 y 0033).
const VALID = { minimum_decision_window_hours: '48', default_charge_lead_hours: '48' };

describe('BusinessSettingsFormSchema', () => {
  it.each(['1', '24', '720'])('accepts a decision window of %s hours', (raw) => {
    // Act
    const result = BusinessSettingsFormSchema.safeParse({
      ...VALID,
      minimum_decision_window_hours: raw,
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it.each(['1', '24', '720'])('accepts a charge lead time of %s hours', (raw) => {
    // Act
    const result = BusinessSettingsFormSchema.safeParse({
      ...VALID,
      default_charge_lead_hours: raw,
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it('coerces the form strings to integers', () => {
    // Act
    const result = BusinessSettingsFormSchema.parse({
      minimum_decision_window_hours: '48',
      default_charge_lead_hours: '24',
    });

    // Assert
    expect(result).toEqual({
      minimum_decision_window_hours: 48,
      default_charge_lead_hours: 24,
    });
  });

  it.each([['0'], ['721'], ['12.5'], ['abc'], [''], [null]])(
    'rejects %j as a decision window',
    (raw) => {
      // Act
      const result = BusinessSettingsFormSchema.safeParse({
        ...VALID,
        minimum_decision_window_hours: raw,
      });

      // Assert
      expect(result.success).toBe(false);
    },
  );

  it.each([['0'], ['721'], ['12.5'], ['abc'], [''], [null]])(
    'rejects %j as a charge lead time',
    (raw) => {
      // Act
      const result = BusinessSettingsFormSchema.safeParse({
        ...VALID,
        default_charge_lead_hours: raw,
      });

      // Assert
      expect(result.success).toBe(false);
    },
  );
});
