import { describe, expect, it } from 'vitest';
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
