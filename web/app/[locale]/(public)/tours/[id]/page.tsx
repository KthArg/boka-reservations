import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';
import { getTourBySlug, getTourPricing, getUpcomingInstances } from '@/lib/public/tours';
import { isPublicReadThrottled } from '@/lib/public/read-limit';
import { isTourBookable } from '@/lib/public/tour-bookable';
import { isSalesEnabled } from '@/lib/booking/sales-gate';
import { PriceList } from '@/components/public/PriceList/PriceList';
import { AvailabilityCalendar } from '@/components/public/AvailabilityCalendar/AvailabilityCalendar';
import { toCalendarDepartures } from '@/lib/public/calendar-departures';
import { crDate } from '@/lib/dates/cr-date';
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

  const [pricing, instances, salesEnabled] = await Promise.all([
    getTourPricing(tour.id),
    getUpcomingInstances(tour.id),
    isSalesEnabled(),
  ]);
  // Spec 0034: sin la información que prometen los términos, o sin datos del operador, el tour se
  // muestra pero no se puede reservar.
  const bookable = salesEnabled && isTourBookable(tour, pricing);

  const name = locale === 'es' ? tour.name_es : tour.name_en;
  const description = locale === 'es' ? tour.description_es : tour.description_en;
  const includes = locale === 'es' ? tour.includes_es : tour.includes_en;
  const excludes = locale === 'es' ? tour.excludes_es : tour.excludes_en;
  const requirements = locale === 'es' ? tour.requirements_es : tour.requirements_en;
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

          {excludes.trim() && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('detail-excludes')}</h2>
              <p className={styles.prose}>{excludes}</p>
            </section>
          )}

          {requirements.trim() && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('detail-requirements')}</h2>
              <p className={styles.prose}>{requirements}</p>
            </section>
          )}

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('detail-meeting-point')}</h2>
            <p className={styles.prose}>{meetingPoint}</p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('detail-prices')}</h2>
            <PriceList pricing={pricing} />
            {tour.child_age_min !== null && tour.child_age_max !== null && (
              <p className={styles.prose}>
                {t('detail-child-ages', { min: tour.child_age_min, max: tour.child_age_max })}
              </p>
            )}
          </section>
        </div>

        <aside className={styles.aside}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t('detail-availability')}</h2>
            {bookable ? (
              <AvailabilityCalendar
                departures={toCalendarDepartures(instances, locale)}
                today={crDate()}
                tourSlug={slug}
              />
            ) : (
              <p className={styles.prose}>{t('detail-not-bookable')}</p>
            )}
          </section>
        </aside>
      </div>
    </article>
  );
}
