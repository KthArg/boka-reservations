import { getTranslations } from 'next-intl/server';
import { listActiveTours } from '@/lib/public/tours';
import { isPublicReadThrottled } from '@/lib/public/read-limit';
import { TourGrid } from '@/components/public/TourGrid/TourGrid';
import styles from './tours.module.css';

export default async function ToursPage() {
  const t = await getTranslations('public');

  const header = (
    <header className={styles.hero}>
      <p className={styles.eyebrow}>{t('hero-title')}</p>
      <h1 className={styles.title}>{t('tours-title')}</h1>
    </header>
  );

  // INFRA-05 (spec 0023): freno anti-scraping por IP a las lecturas públicas.
  if (await isPublicReadThrottled()) {
    return (
      <section>
        {header}
        <p className={styles.empty}>{t('rate-limited')}</p>
      </section>
    );
  }

  const tours = await listActiveTours();

  return (
    <section>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>{t('hero-title')}</p>
        <h1 className={styles.title}>{t('tours-title')}</h1>
        <p className={styles.lead}>{t('tours-subtitle')}</p>
      </header>
      {tours.length === 0 ? <p className={styles.empty}>—</p> : <TourGrid tours={tours} />}
    </section>
  );
}
