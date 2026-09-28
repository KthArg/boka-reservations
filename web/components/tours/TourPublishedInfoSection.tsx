'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FieldErrors } from '@/lib/tours/types';
import { TourField } from './TourField';
import styles from './TourForm.module.css';

export type TourPublishedInfo = {
  excludes_es: string;
  excludes_en: string;
  requirements_es: string;
  requirements_en: string;
  child_age_min: number | null;
  child_age_max: number | null;
};

type Props = {
  defaultValues?: TourPublishedInfo;
  errors: FieldErrors;
};

const TEXT_FIELDS = ['excludes_es', 'excludes_en', 'requirements_es', 'requirements_en'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

const asText = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

/**
 * Lo que la cláusula 3 de los términos promete publicar de cada tour y que obliga al operador
 * (spec 0034): qué no incluye, requisitos y edades del tiquete de niño. Un tour sin esto no se
 * puede reservar. Estado propio y controlado: React 19 hace form.reset() tras la action y
 * borraría lo escrito si la validación falla.
 */
export default function TourPublishedInfoSection({ defaultValues, errors }: Props) {
  const t = useTranslations('tours');
  const [text, setText] = useState<Record<TextField, string>>({
    excludes_es: defaultValues?.excludes_es ?? '',
    excludes_en: defaultValues?.excludes_en ?? '',
    requirements_es: defaultValues?.requirements_es ?? '',
    requirements_en: defaultValues?.requirements_en ?? '',
  });
  const [ageMin, setAgeMin] = useState(asText(defaultValues?.child_age_min));
  const [ageMax, setAgeMax] = useState(asText(defaultValues?.child_age_max));

  return (
    <fieldset className={styles.section}>
      <legend className={styles.sectionTitle}>{t('published-info')}</legend>
      <p className={styles.hint}>{t('published-info-hint')}</p>

      <div className={styles.grid2}>
        {TEXT_FIELDS.map((field) => (
          <TourField
            key={field}
            label={t(`field-${field.replace('_', '-')}`)}
            name={field}
            value={text[field]}
            onChange={(value) => setText((current) => ({ ...current, [field]: value }))}
            errors={errors[field]}
            multiline
          />
        ))}
      </div>

      <div className={styles.grid2}>
        <TourField
          label={t('field-child-age-min')}
          name="child_age_min"
          type="number"
          min={0}
          value={ageMin}
          onChange={setAgeMin}
          errors={errors.child_age_min}
        />
        <TourField
          label={t('field-child-age-max')}
          name="child_age_max"
          type="number"
          min={0}
          value={ageMax}
          onChange={setAgeMax}
          errors={errors.child_age_max}
        />
      </div>
      <p className={styles.hint}>{t('hint-child-ages')}</p>
    </fieldset>
  );
}
