'use client';

import { useTranslations } from 'next-intl';
import type { PricingRow } from '@/lib/tours/types';
import { MonthDayField } from './MonthDayField';
import styles from './PricingEditor.module.css';

type Props = { row: PricingRow; onChange: (patch: Partial<PricingRow>) => void };

/** Una temporada nueva arranca en enero; el admin la ajusta. */
const NEW_SEASON = { season_start: '01-01', season_end: '01-31' };
const BASE_PRICE = { season_start: null, season_end: null, season_label: null };

/**
 * Tipo de tarifa y, si es temporada, su nombre y su día-mes de inicio y fin, sin año (spec 0040).
 */
export function SeasonFields({ row, onChange }: Props) {
  const t = useTranslations('tours');
  const isSeason = row.season_start != null && row.season_end != null;

  return (
    <>
      <label className={styles.fieldLabel}>
        {t('pricing-kind')}
        <select
          className={styles.select}
          value={isSeason ? 'season' : 'base'}
          onChange={(e) => onChange(e.target.value === 'season' ? NEW_SEASON : BASE_PRICE)}
        >
          <option value="base">{t('pricing-kind-base')}</option>
          <option value="season">{t('pricing-kind-season')}</option>
        </select>
      </label>

      {isSeason ? (
        <>
          <label className={styles.fieldLabel}>
            {t('pricing-season-label')}
            <input
              type="text"
              className={styles.input}
              value={row.season_label ?? ''}
              onChange={(e) => onChange({ season_label: e.target.value || null })}
            />
          </label>
          <MonthDayField
            label={t('pricing-season-start')}
            value={row.season_start!}
            onChange={(md) => onChange({ season_start: md })}
          />
          <MonthDayField
            label={t('pricing-season-end')}
            value={row.season_end!}
            onChange={(md) => onChange({ season_end: md })}
          />
        </>
      ) : null}
    </>
  );
}
