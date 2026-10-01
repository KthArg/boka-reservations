import { useTranslations } from 'next-intl';
import { TourDifficulty } from '@shared/constants/enums';
import type { TourBasicValues, FieldErrors } from '@/lib/tours/types';
import { TourImageUpload } from './TourImageUpload';
import { TourField } from './TourField';
import styles from './TourForm.module.css';

type Props = {
  values: TourBasicValues;
  onChange: (name: keyof TourBasicValues, value: string) => void;
  errors: FieldErrors;
};

const DIFFICULTIES = [TourDifficulty.Easy, TourDifficulty.Moderate, TourDifficulty.Hard] as const;

/**
 * Ficha del tour (spec 0042): foto, dificultad, duración, capacidades y slug. En pantallas anchas
 * va en la columna lateral del formulario, junto a los textos.
 */
export default function TourDetailsSection({ values, onChange, errors }: Props) {
  const t = useTranslations('tours');

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{t('details-section')}</legend>
      <TourImageUpload
        value={values.cover_image_url}
        onChange={(v) => onChange('cover_image_url', v)}
        errors={errors.cover_image_url}
      />
      <div className={styles.detailsGrid}>
        <label className={styles.label}>
          {t('field-difficulty')}
          <select
            name="difficulty"
            className={styles.input}
            value={values.difficulty}
            onChange={(e) => onChange('difficulty', e.target.value)}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {t(`difficulty-${d}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
          {errors.difficulty?.map((e) => (
            <span key={e} className={styles.fieldError}>
              {e}
            </span>
          ))}
        </label>
        <TourField
          label={t('field-duration')}
          name="duration_minutes"
          type="number"
          value={values.duration_minutes}
          onChange={(v) => onChange('duration_minutes', v)}
          errors={errors.duration_minutes}
          min={1}
        />
        <TourField
          label={t('field-min-participants')}
          name="min_participants"
          type="number"
          value={values.min_participants}
          onChange={(v) => onChange('min_participants', v)}
          errors={errors.min_participants}
          min={1}
        />
        <TourField
          label={t('field-max-capacity')}
          name="max_capacity"
          type="number"
          value={values.max_capacity}
          onChange={(v) => onChange('max_capacity', v)}
          errors={errors.max_capacity}
          min={1}
        />
      </div>
      <TourField
        label={t('field-slug')}
        name="slug"
        value={values.slug}
        onChange={(v) => onChange('slug', v)}
        errors={errors.slug}
      />
    </fieldset>
  );
}
