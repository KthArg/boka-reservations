import { describe, expect, it } from 'vitest';
import { ChargeTiming } from '@shared/constants/tours';
import { parseTourFields } from './parse';
import { TourFormSchema } from './types';

const VALID_FIELDS: Record<string, string> = {
  slug: 'volcan-arenal',
  name_es: 'Volcán Arenal',
  name_en: 'Arenal Volcano',
  description_es: 'Caminata',
  description_en: 'Hike',
  difficulty: 'easy',
  duration_minutes: '120',
  meeting_point_es: 'Plaza',
  meeting_point_en: 'Square',
  includes_es: 'Guía',
  includes_en: 'Guide',
  min_participants: '4',
  max_capacity: '12',
  cover_image_url: '',
};

function formWith(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

describe('parseTourFields — auto_cancel_below_minimum', () => {
  it('reads a checked box as true', () => {
    // Arrange
    const form = formWith({ ...VALID_FIELDS, auto_cancel_below_minimum: 'on' });

    // Act
    const fields = parseTourFields(form);

    // Assert
    expect(fields.auto_cancel_below_minimum).toBe(true);
  });

  it('reads an unchecked box, which the browser omits, as false', () => {
    // Act
    const fields = parseTourFields(formWith(VALID_FIELDS));

    // Assert
    expect(fields.auto_cancel_below_minimum).toBe(false);
  });
});

describe('TourFormSchema — auto_cancel_below_minimum', () => {
  it('keeps the toggle when the form enables it', () => {
    // Arrange
    const form = formWith({ ...VALID_FIELDS, auto_cancel_below_minimum: 'on' });

    // Act
    const result = TourFormSchema.parse(parseTourFields(form));

    // Assert
    expect(result.auto_cancel_below_minimum).toBe(true);
  });

  it('defaults to staff decision when the field is absent', () => {
    // Arrange
    const fields = parseTourFields(formWith(VALID_FIELDS));
    delete fields.auto_cancel_below_minimum;

    // Act
    const result = TourFormSchema.parse(fields);

    // Assert
    expect(result.auto_cancel_below_minimum).toBe(false);
  });
});

describe('TourFormSchema — charge_timing y charge_lead_hours', () => {
  it('keeps the timing and the lead time the form sends', () => {
    // Arrange
    const form = formWith({
      ...VALID_FIELDS,
      charge_timing: ChargeTiming.BeforeDeparture,
      charge_lead_hours: '12',
    });

    // Act
    const result = TourFormSchema.parse(parseTourFields(form));

    // Assert
    expect(result.charge_timing).toBe(ChargeTiming.BeforeDeparture);
    expect(result.charge_lead_hours).toBe(12);
  });

  it('reads an empty lead time as null, which means the global value', () => {
    // Arrange
    const form = formWith({
      ...VALID_FIELDS,
      charge_timing: ChargeTiming.BeforeDeparture,
      charge_lead_hours: '',
    });

    // Act
    const result = TourFormSchema.parse(parseTourFields(form));

    // Assert
    expect(result.charge_lead_hours).toBeNull();
  });

  it('reads an absent lead time as null, which is what "on the minimum" sends', () => {
    // Arrange
    const form = formWith({ ...VALID_FIELDS, charge_timing: ChargeTiming.OnMinimum });

    // Act
    const result = TourFormSchema.parse(parseTourFields(form));

    // Assert
    expect(result.charge_timing).toBe(ChargeTiming.OnMinimum);
    expect(result.charge_lead_hours).toBeNull();
  });

  it('defaults to charging before departure when the field is absent', () => {
    // Act
    const result = TourFormSchema.parse(parseTourFields(formWith(VALID_FIELDS)));

    // Assert
    expect(result.charge_timing).toBe(ChargeTiming.BeforeDeparture);
  });

  it.each(['0', '721', '12.5', 'abc'])('rejects %j as a lead time', (raw) => {
    // Arrange
    const form = formWith({ ...VALID_FIELDS, charge_lead_hours: raw });

    // Act
    const result = TourFormSchema.safeParse(parseTourFields(form));

    // Assert
    expect(result.success).toBe(false);
  });
});
