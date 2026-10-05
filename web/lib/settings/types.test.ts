import { describe, expect, it } from 'vitest';
import { BusinessSettingsFormSchema } from './types';

// El formulario manda strings: los dos campos coercen a entero y comparten el rango 1..720 de
// sus CHECK de DB (specs 0029 y 0033).
const VALID = {
  minimum_decision_window_hours: '48',
  default_charge_lead_hours: '48',
  booking_cutoff_hours: '3',
  below_minimum_policy: 'staff_decides',
};

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

  // El piso es de 32 horas (migración …055): el plazo de cobro vence 30 horas antes.
  it.each(['32', '48', '720'])('accepts a charge lead time of %s hours', (raw) => {
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
      default_charge_lead_hours: '36',
      booking_cutoff_hours: '3',
      below_minimum_policy: 'auto_cancel',
    });

    // Assert
    expect(result).toEqual({
      minimum_decision_window_hours: 48,
      default_charge_lead_hours: 36,
      booking_cutoff_hours: 3,
      below_minimum_policy: 'auto_cancel',
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

  it.each([['0'], ['31'], ['721'], ['36.5'], ['abc'], [''], [null]])(
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

describe('BusinessSettingsFormSchema — anticipación mínima (spec 0041)', () => {
  it.each(['0', '3', '72'])('accepts %s hours', (raw) => {
    expect(
      BusinessSettingsFormSchema.safeParse({ ...VALID, booking_cutoff_hours: raw }).success,
    ).toBe(true);
  });

  it.each(['-1', '73', '2.5', ''])('rejects %s', (raw) => {
    const result = BusinessSettingsFormSchema.safeParse({ ...VALID, booking_cutoff_hours: raw });
    expect(result.success).toBe(false);
  });

  // Spec 0045: solo las dos políticas conocidas.
  it.each(['', 'cancel', null])('rejects %j as a below-minimum policy', (raw) => {
    expect(
      BusinessSettingsFormSchema.safeParse({ ...VALID, below_minimum_policy: raw }).success,
    ).toBe(false);
  });
});
