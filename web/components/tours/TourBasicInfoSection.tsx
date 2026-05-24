import { useTranslations } from 'next-intl';
import { TourDifficulty } from '@shared/constants/enums';
import type { TourWithDetails } from '@/lib/tours/types';
import type { FieldErrors } from '@/lib/tours/types';
import styles from './TourForm.module.css';

type Props = {
  defaultValues?: TourWithDetails;
  errors: FieldErrors;
};

const DIFFICULTIES = [TourDifficulty.Easy, TourDifficulty.Moderate, TourDifficulty.Hard] as const;

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  errors,
  multiline,
  min,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number | null;
  errors?: string[];
  multiline?: boolean;
  min?: number;
}) {
  const inputProps = {
    name,
    className: styles.input,
    defaultValue: defaultValue ?? undefined,
    min,
  };
  return (
    <label className={styles.label}>
      {label}
      {multiline ? (
        <textarea {...inputProps} className={styles.textarea} rows={3} />
      ) : (
        <input type={type} {...inputProps} />
      )}
      {errors?.map((e) => (
        <span key={e} className={styles.fieldError}>
          {e}
        </span>
      ))}
    </label>
  );
}

export default function TourBasicInfoSection({ defaultValues: dv, errors }: Props) {
  const t = useTranslations('tours');

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{t('basic-info')}</legend>

      <div className={styles.grid2}>
        <Field
          label={t('field-name-es')}
          name="name_es"
          defaultValue={dv?.name_es}
          errors={errors.name_es}
        />
        <Field
          label={t('field-name-en')}
          name="name_en"
          defaultValue={dv?.name_en}
          errors={errors.name_en}
        />
        <Field
          label={t('field-description-es')}
          name="description_es"
          defaultValue={dv?.description_es}
          errors={errors.description_es}
          multiline
        />
        <Field
          label={t('field-description-en')}
          name="description_en"
          defaultValue={dv?.description_en}
          errors={errors.description_en}
          multiline
        />
        <Field
          label={t('field-meeting-point-es')}
          name="meeting_point_es"
          defaultValue={dv?.meeting_point_es}
          errors={errors.meeting_point_es}
          multiline
        />
        <Field
          label={t('field-meeting-point-en')}
          name="meeting_point_en"
          defaultValue={dv?.meeting_point_en}
          errors={errors.meeting_point_en}
          multiline
        />
        <Field
          label={t('field-includes-es')}
          name="includes_es"
          defaultValue={dv?.includes_es}
          errors={errors.includes_es}
          multiline
        />
        <Field
          label={t('field-includes-en')}
          name="includes_en"
          defaultValue={dv?.includes_en}
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
            defaultValue={dv?.difficulty ?? TourDifficulty.Easy}
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
        <Field
          label={t('field-duration')}
          name="duration_minutes"
          type="number"
          defaultValue={dv?.duration_minutes}
          errors={errors.duration_minutes}
          min={1}
        />
        <Field
          label={t('field-min-participants')}
          name="min_participants"
          type="number"
          defaultValue={dv?.min_participants}
          errors={errors.min_participants}
          min={1}
        />
        <Field
          label={t('field-max-capacity')}
          name="max_capacity"
          type="number"
          defaultValue={dv?.max_capacity}
          errors={errors.max_capacity}
          min={1}
        />
        <Field label={t('field-slug')} name="slug" defaultValue={dv?.slug} errors={errors.slug} />
        <Field
          label={t('field-cover-image')}
          name="cover_image_url"
          defaultValue={dv?.cover_image_url}
          errors={errors.cover_image_url}
        />
      </div>
    </fieldset>
  );
}
