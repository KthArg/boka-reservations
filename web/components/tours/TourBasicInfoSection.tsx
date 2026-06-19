import { useTranslations } from 'next-intl';
import { TourDifficulty } from '@shared/constants/enums';
import type { TourBasicValues, FieldErrors } from '@/lib/tours/types';
import { TourField } from './TourField';
import styles from './TourForm.module.css';

type Props = {
  values: TourBasicValues;
  onChange: (name: keyof TourBasicValues, value: string) => void;
  errors: FieldErrors;
};

const DIFFICULTIES = [TourDifficulty.Easy, TourDifficulty.Moderate, TourDifficulty.Hard] as const;

export default function TourBasicInfoSection({ values, onChange, errors }: Props) {
  const t = useTranslations('tours');

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{t('basic-info')}</legend>

      <div className={styles.grid2}>
        <TourField
          label={t('field-name-es')}
          name="name_es"
          value={values.name_es}
          onChange={(v) => onChange('name_es', v)}
          errors={errors.name_es}
        />
        <TourField
          label={t('field-name-en')}
          name="name_en"
          value={values.name_en}
          onChange={(v) => onChange('name_en', v)}
          errors={errors.name_en}
        />
        <TourField
          label={t('field-description-es')}
          name="description_es"
          value={values.description_es}
          onChange={(v) => onChange('description_es', v)}
          errors={errors.description_es}
          multiline
        />
        <TourField
          label={t('field-description-en')}
          name="description_en"
          value={values.description_en}
          onChange={(v) => onChange('description_en', v)}
          errors={errors.description_en}
          multiline
        />
        <TourField
          label={t('field-meeting-point-es')}
          name="meeting_point_es"
          value={values.meeting_point_es}
          onChange={(v) => onChange('meeting_point_es', v)}
          errors={errors.meeting_point_es}
          multiline
        />
        <TourField
          label={t('field-meeting-point-en')}
          name="meeting_point_en"
          value={values.meeting_point_en}
          onChange={(v) => onChange('meeting_point_en', v)}
          errors={errors.meeting_point_en}
          multiline
        />
        <TourField
          label={t('field-includes-es')}
          name="includes_es"
          value={values.includes_es}
          onChange={(v) => onChange('includes_es', v)}
          errors={errors.includes_es}
          multiline
        />
        <TourField
          label={t('field-includes-en')}
          name="includes_en"
          value={values.includes_en}
          onChange={(v) => onChange('includes_en', v)}
          errors={errors.includes_en}
          multiline
        />
      </div>

      <div className={styles.grid3}>
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
        <TourField
          label={t('field-slug')}
          name="slug"
          value={values.slug}
          onChange={(v) => onChange('slug', v)}
          errors={errors.slug}
        />
        <TourField
          label={t('field-cover-image')}
          name="cover_image_url"
          value={values.cover_image_url}
          onChange={(v) => onChange('cover_image_url', v)}
          errors={errors.cover_image_url}
        />
      </div>
    </fieldset>
  );
}
