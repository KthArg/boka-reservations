import { getTranslations } from 'next-intl/server';
import type { ReportRange } from '@/lib/reports/range';
import styles from './reports.module.css';

/** Selector de rango de fechas: form GET que actualiza la URL (sin client JS). */
export async function ReportsFilters({ range }: { range: ReportRange }) {
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
      <button type="submit" className={styles.primaryBtn}>
        {t('apply')}
      </button>
    </form>
  );
}
