'use client';

import { useTranslations } from 'next-intl';
import { TicketType } from '@shared/constants/enums';
import type { PricingRow } from '@/lib/tours/types';
import { PRICE_RULE } from '@/lib/tours/number-rules';
import { NumberField } from '@/components/forms/NumberField';
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

export default function PricingEditor({ value, onChange, errors, showErrors }: Props) {
  const t = useTranslations('tours');

  function update(index: number, patch: Partial<PricingRow>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    onChange([...value, emptyRow()]);
  }

  return (
    <div className={styles.editor}>
      <h3 className={styles.sectionTitle}>{t('pricing-section')}</h3>

      {errors?.map((e) => (
        <p key={e} className={styles.error}>
          {e}
        </p>
      ))}

      {value.length > 0 && (
        <div className={styles.rows}>
          {value.map((row, i) => (
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

              <label className={styles.fieldLabel}>
                {t('pricing-season-label')}
                <input
                  type="text"
                  className={styles.input}
                  value={row.season_label ?? ''}
                  onChange={(e) => update(i, { season_label: e.target.value || null })}
                />
              </label>

              <label className={styles.fieldLabel}>
                {t('pricing-valid-from')}
                <input
                  type="date"
                  className={styles.input}
                  value={row.valid_from ?? ''}
                  onChange={(e) => update(i, { valid_from: e.target.value || null })}
                />
              </label>

              <label className={styles.fieldLabel}>
                {t('pricing-valid-until')}
                <input
                  type="date"
                  className={styles.input}
                  value={row.valid_until ?? ''}
                  onChange={(e) => update(i, { valid_until: e.target.value || null })}
                />
              </label>

              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={row.active}
                  onChange={(e) => update(i, { active: e.target.checked })}
                />
                {t('pricing-active')}
              </label>
            </div>
          ))}
        </div>
      )}

      <button type="button" className={styles.addBtn} onClick={addRow}>
        + {t('pricing-add-row')}
      </button>
    </div>
  );
}
