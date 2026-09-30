import { getTranslations } from 'next-intl/server';
import { listActiveTours } from '@/lib/public/tours';
import { isPublicReadThrottled } from '@/lib/public/read-limit';
import { TourGrid } from '@/components/public/TourGrid/TourGrid';
import styles from './tours.module.css';

export default async function ToursPage() {
  const t = await getTranslations('public');

  // Spec 0042: héroe en verde noche con sol y luna, como la landing; el título sube por líneas.
  const hero = (withLead: boolean) => (
    <header className={`theme-night ${styles.hero}`}>
      <span className={styles.sun} aria-hidden="true" />
      <span className={styles.moon} aria-hidden="true" />
      <div className={styles.heroText}>
        <p className={`bv-fade ${styles.eyebrow}`}>{t('hero-title')}</p>
        <h1 className={styles.title}>
          <span className="bv-line">
            <span>{t('tours-title')}</span>
          </span>
        </h1>
        {withLead ? (
          <p className={`bv-rise ${styles.lead}`} style={{ '--i': 3 } as React.CSSProperties}>
            {t('tours-subtitle')}
          </p>
        ) : null}
      </div>
    </header>
  );

  // INFRA-05 (spec 0023): freno anti-scraping por IP a las lecturas públicas.
  if (await isPublicReadThrottled()) {
    return (
      <section className={styles.page}>
        {hero(false)}
        <p className={styles.empty}>{t('rate-limited')}</p>
      </section>
    );
  }

  const tours = await listActiveTours();

  return (
    <section className={styles.page}>
      {hero(true)}
      {tours.length === 0 ? <p className={styles.empty}>—</p> : <TourGrid tours={tours} />}
    </section>
  );
}
