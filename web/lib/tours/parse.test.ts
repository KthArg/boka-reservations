import { describe, expect, it } from 'vitest';
import { ChargeTiming, TourActionError } from '@shared/constants/tours';
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
  excludes_es: 'Transporte',
  excludes_en: 'Transport',
  requirements_es: 'Mayores de 6 años',
  requirements_en: 'Ages 6 and up',
  child_age_min: '',
  child_age_max: '',
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
      charge_lead_hours: '36',
    });

    // Act
    const result = TourFormSchema.parse(parseTourFields(form));

    // Assert
    expect(result.charge_timing).toBe(ChargeTiming.BeforeDeparture);
    expect(result.charge_lead_hours).toBe(36);
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

  // Con menos de 32 horas el ciclo abriría sin ventana antes de su plazo (…055).
  it.each(['0', '31', '721', '36.5', 'abc'])('rejects %j as a lead time', (raw) => {
    // Arrange
    const form = formWith({ ...VALID_FIELDS, charge_lead_hours: raw });

    // Act
    const result = TourFormSchema.safeParse(parseTourFields(form));

    // Assert
    expect(result.success).toBe(false);
  });
});

describe('TourFormSchema — información publicada (spec 0034)', () => {
  function issuesFor(fields: Record<string, string>): string[] {
    const result = TourFormSchema.safeParse(parseTourFields(formWith(fields)));
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  }

  it.each(['excludes_es', 'excludes_en', 'requirements_es', 'requirements_en'])(
    'rechaza %s vacío',
    (field) => {
      expect(issuesFor({ ...VALID_FIELDS, [field]: '  ' })).not.toEqual([]);
    },
  );

  it('rechaza una sola de las dos edades del tiquete de niño', () => {
    expect(issuesFor({ ...VALID_FIELDS, child_age_min: '6', child_age_max: '' })).toContain(
      TourActionError.ChildAgesRequired,
    );
  });

  it('rechaza edades invertidas', () => {
    expect(issuesFor({ ...VALID_FIELDS, child_age_min: '12', child_age_max: '6' })).toContain(
      TourActionError.ChildAgesInvalid,
    );
  });

  it('acepta las dos edades en orden', () => {
    expect(issuesFor({ ...VALID_FIELDS, child_age_min: '3', child_age_max: '11' })).toEqual([]);
  });
});
