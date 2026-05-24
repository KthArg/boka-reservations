import { getTranslations } from 'next-intl/server';
import { listActiveTours } from '@/lib/public/tours';
import { TourGrid } from '@/components/public/TourGrid/TourGrid';
import styles from './tours.module.css';

export default async function ToursPage() {
  const [t, tours] = await Promise.all([getTranslations('public'), listActiveTours()]);

  return (
    <section>
      <h1 className={styles.title}>{t('tours-title')}</h1>
      {tours.length === 0 ? <p className={styles.empty}>—</p> : <TourGrid tours={tours} />}
    </section>
  );
}
