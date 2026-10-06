import { getTranslations } from 'next-intl/server';
import { RevenueBasis } from '@shared/constants/reports';
import type { ReportRange } from '@/lib/reports/range';
import styles from './reports.module.css';

type Props = { range: ReportRange; basis: RevenueBasis };

/**
 * Selector de rango de fechas y del criterio de los ingresos (spec 0046): form GET que actualiza
 * la URL (sin client JS).
 */
export async function ReportsFilters({ range, basis }: Props) {
  const t = await getTranslations('reports');
  return (
    <form className={styles.filters} method="get" action="">
      <div className={styles.field}>
        <label className={styles.label} htmlFor="from">
          {t('from')}
        </label>
        <input
          className={styles.input}
          type="date"
          id="from"
          name="from"
          defaultValue={range.from}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="to">
          {t('to')}
        </label>
        <input className={styles.input} type="date" id="to" name="to" defaultValue={range.to} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="basis">
          {t('basis-label')}
        </label>
        <select className={styles.input} id="basis" name="basis" defaultValue={basis}>
          <option value={RevenueBasis.Payment}>{t('basis-payment')}</option>
          <option value={RevenueBasis.Departure}>{t('basis-departure')}</option>
        </select>
      </div>
      <button type="submit" className={styles.primaryBtn}>
        {t('apply')}
      </button>
    </form>
  );
}
