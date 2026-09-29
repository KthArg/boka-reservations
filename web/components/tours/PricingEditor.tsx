'use client';

import { useTranslations } from 'next-intl';
import { TicketType } from '@shared/constants/enums';
import { TourActionError } from '@shared/constants/tours';
import type { PricingRow } from '@/lib/tours/types';
import { PRICE_RULE } from '@/lib/tours/number-rules';
import { detectPricingOverlaps } from '@/lib/tours/validation';
import { NumberField } from '@/components/forms/NumberField';
import { SeasonFields } from './SeasonFields';
import styles from './PricingEditor.module.css';

type Props = {
  value: PricingRow[];
  onChange: (rows: PricingRow[]) => void;
  errors?: string[];
  /** El formulario intentó guardar: mostrar los errores de campos sin tocar. */
  showErrors?: boolean;
};

const TICKET_TYPES = [TicketType.Adult, TicketType.Child, TicketType.Student] as const;
function emptyRow(): PricingRow {
  return { ticket_type: TicketType.Adult, price_usd: 0, active: true };
}

/**
 * Tarifas del tour (spec 0040): cada fila es un precio base o una temporada con día y mes de
 * inicio y fin, sin año, que se repite todos los años. Los choques se marcan en la fila.
 */
export default function PricingEditor({ value, onChange, errors, showErrors }: Props) {
  const t = useTranslations('tours');

  function update(index: number, patch: Partial<PricingRow>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  // Cada fila con problema dice cuál es y, si choca, con qué temporada (spec 0040).
  const conflicts = new Map<number, string>();
  for (const { code, indices } of detectPricingOverlaps(value)) {
    const [a, b] = indices;
    for (const [index, other] of [
      [a, b],
      [b, a],
    ]) {
      conflicts.set(
        index,
        code === TourActionError.BasePriceDuplicate
          ? t('pricing-conflict-base')
          : t('pricing-conflict-season', { other: value[other].season_label ?? '' }),
      );
    }
  }
  value.forEach((row, index) => {
    const isSeason = row.season_start != null && row.season_end != null;
    if (isSeason && !row.season_label && !conflicts.has(index)) {
      conflicts.set(index, t('pricing-label-required'));
    }
  });

  return (
    <div className={styles.editor}>
      <h3 className={styles.sectionTitle}>{t('pricing-section')}</h3>
      <p className={styles.hint}>{t('pricing-hint')}</p>

      {errors?.map((e) => (
        <p key={e} className={styles.error}>
          {e}
        </p>
      ))}

      {value.length > 0 && (
        <div className={styles.rows}>
          {value.map((row, i) => {
            return (
              <div key={i} className={`${styles.row} ${!row.active ? styles.rowInactive : ''}`}>
                <label className={styles.fieldLabel}>
                  {t('pricing-ticket-type')}
                  <select
                    className={styles.select}
                    value={row.ticket_type}
                    onChange={(e) => update(i, { ticket_type: e.target.value as TicketType })}
                  >
                    {TICKET_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`ticket-${type}` as Parameters<typeof t>[0])}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.fieldLabel}>
                  {t('pricing-price-usd')}
                  <NumberField
                    step="0.01"
                    className={styles.input}
                    value={row.price_usd}
                    onChange={(price) => update(i, { price_usd: price })}
                    rule={PRICE_RULE}
                    mode="report"
                    errorMessage={t('pricing-price-invalid')}
                    forceError={showErrors}
                    errorClassName={styles.error}
                  />
                </label>

                <SeasonFields row={row} onChange={(patch) => update(i, patch)} />

                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={row.active}
                    onChange={(e) => update(i, { active: e.target.checked })}
                  />
                  {t('pricing-active')}
                </label>

                {conflicts.has(i) ? (
                  <p className={styles.error} role="alert" data-pricing-error>
                    {conflicts.get(i)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className={styles.addBtn}
        onClick={() => onChange([...value, emptyRow()])}
      >
        + {t('pricing-add-row')}
      </button>
    </div>
  );
}
