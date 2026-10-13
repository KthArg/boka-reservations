import { getTranslations } from 'next-intl/server';
import { listFixedTours } from '@/lib/public/tours';
import { isPublicReadThrottled } from '@/lib/public/read-limit';
import { TourDiptych } from '@/components/public/TourDiptych/TourDiptych';
import styles from './tours.module.css';

/** Portada del sitio (spec 0047): los dos tours, día y noche, lado a lado. */
export default async function ToursPage() {
  const t = await getTranslations('public');
  // INFRA-05 (spec 0023): freno anti-scraping por IP a las lecturas públicas.
  const throttled = await isPublicReadThrottled();
  const tours = throttled ? [] : await listFixedTours();

  return (
    <section className={styles.page}>
      <header className={styles.intro}>
        <div>
          <p className={`bv-fade ${styles.eyebrow}`}>{t('hero-title')}</p>
          <h1 className={styles.title}>
            <span className="bv-line">
              <span>{t('tours-title')}</span>
            </span>
          </h1>
        </div>
        {tours.length > 0 ? (
          <p className={`bv-rise ${styles.lead}`} style={{ '--i': 2 } as React.CSSProperties}>
            {t('tours-subtitle')}
          </p>
        ) : null}
      </header>
      {tours.length > 0 ? (
        <TourDiptych tours={tours} />
      ) : (
        <p className={styles.empty}>{throttled ? t('rate-limited') : t('tour-unavailable')}</p>
      )}
    </section>
  );
}
