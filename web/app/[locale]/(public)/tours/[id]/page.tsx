import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';
import { getTourBySlug, getTourPricing, getUpcomingInstances } from '@/lib/public/tours';
import { isPublicReadThrottled } from '@/lib/public/read-limit';
import { PriceList } from '@/components/public/PriceList/PriceList';
import { AvailabilityCalendar } from '@/components/public/AvailabilityCalendar/AvailabilityCalendar';
import styles from './slug.module.css';

type Props = { params: Promise<{ id: string }> };

export default async function TourDetailPage({ params }: Props) {
  const { id: slug } = await params;
  const [t, locale] = await Promise.all([getTranslations('public'), getLocale()]);

  // INFRA-05 (spec 0023): freno anti-scraping por IP a las lecturas públicas.
  if (await isPublicReadThrottled()) {
    return (
      <article className={styles.page}>
        <p className={styles.description}>{t('rate-limited')}</p>
      </article>
    );
  }

  const tour = await getTourBySlug(slug);

  if (!tour) notFound();

  const [pricing, instances] = await Promise.all([
    getTourPricing(tour.id),
    getUpcomingInstances(tour.id),
  ]);

  const name = locale === 'es' ? tour.name_es : tour.name_en;
  const description = locale === 'es' ? tour.description_es : tour.description_en;
  const includes = locale === 'es' ? tour.includes_es : tour.includes_en;
  const meetingPoint = locale === 'es' ? tour.meeting_point_es : tour.meeting_point_en;
  const difficultyKey = `tours-difficulty-${tour.difficulty}` as const;

  return (
    <article className={styles.page}>
      {tour.cover_image_url && (
        <img src={tour.cover_image_url} alt={name} className={styles.cover} />
      )}

      <header className={styles.header}>
        <h1 className={styles.title}>{name}</h1>
        <div className={styles.meta}>
          <span className={styles.metaItem}>
            <strong>{t('detail-difficulty')}:</strong> {t(difficultyKey)}
          </span>
          <span className={styles.metaItem}>
            <strong>{t('detail-duration')}:</strong>{' '}
            {t('tours-duration', { n: tour.duration_minutes })}
          </span>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.mainCol}>
          <p className={styles.description}>{description}</p>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('detail-includes')}</h2>
            <p className={styles.prose}>{includes}</p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('detail-meeting-point')}</h2>
            <p className={styles.prose}>{meetingPoint}</p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('detail-prices')}</h2>
            <PriceList pricing={pricing} />
          </section>
        </div>

        <aside className={styles.aside}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('detail-availability')}</h2>
            <AvailabilityCalendar instances={instances} tourSlug={slug} />
          </section>
        </aside>
      </div>
    </article>
  );
}
