import { useTranslations } from 'next-intl';
import type { TourBasicValues, FieldErrors } from '@/lib/tours/types';
import { TourField } from './TourField';
import styles from './TourForm.module.css';

type Props = {
  values: TourBasicValues;
  onChange: (name: keyof TourBasicValues, value: string) => void;
  errors: FieldErrors;
};

/** Textos del tour en los dos idiomas. La ficha (números, slug y foto) va en TourDetailsSection. */
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
    </fieldset>
  );
}
