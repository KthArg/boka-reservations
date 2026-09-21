import { describe, expect, it } from 'vitest';
import { BusinessSettingsFormSchema } from './types';

describe('BusinessSettingsFormSchema', () => {
  it.each(['1', '24', '720'])('accepts a decision window of %s hours', (raw) => {
    // Act
    const result = BusinessSettingsFormSchema.safeParse({ minimum_decision_window_hours: raw });

    // Assert
    expect(result.success).toBe(true);
  });

  it('coerces the form string to an integer', () => {
    // Act
    const result = BusinessSettingsFormSchema.parse({ minimum_decision_window_hours: '48' });

    // Assert
    expect(result.minimum_decision_window_hours).toBe(48);
  });

  it.each([['0'], ['721'], ['12.5'], ['abc'], [''], [null]])(
    'rejects %j as a decision window',
    (raw) => {
      // Act
      const result = BusinessSettingsFormSchema.safeParse({ minimum_decision_window_hours: raw });

      // Assert
      expect(result.success).toBe(false);
    },
  );
});
