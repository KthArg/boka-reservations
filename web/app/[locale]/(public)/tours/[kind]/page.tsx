import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';
import { Clock, MapPin, Mountain } from 'lucide-react';
import { getFixedTour, getTourPriceList, getUpcomingInstances } from '@/lib/public/tours';
import { isPublicReadThrottled } from '@/lib/public/read-limit';
import { isTourBookable } from '@/lib/public/tour-bookable';
import { isSalesEnabled } from '@/lib/booking/sales-gate';
import { getBookingCutoffHours } from '@/lib/operator/repository';
import { PriceList } from '@/components/public/PriceList/PriceList';
import { AvailabilityCalendar } from '@/components/public/AvailabilityCalendar/AvailabilityCalendar';
import { ShiftBadge } from '@/components/public/ShiftBadge/ShiftBadge';
import { toCalendarDepartures } from '@/lib/public/calendar-departures';
import { crDate } from '@/lib/dates/cr-date';
import { isTourKind, TourKind, TourStatus } from '@shared/constants/enums';
import styles from './tour.module.css';

type Props = { params: Promise<{ kind: string }> };

export default async function TourDetailPage({ params }: Props) {
  const { kind } = await params;
  if (!isTourKind(kind)) notFound();
  const [t, locale] = await Promise.all([getTranslations('public'), getLocale()]);

  // INFRA-05 (spec 0023): freno anti-scraping por IP a las lecturas públicas.
  if (await isPublicReadThrottled()) {
    return (
      <article className={styles.page}>
        <p className={styles.description}>{t('rate-limited')}</p>
      </article>
    );
  }

  const tour = await getFixedTour(kind);

  if (!tour) notFound();

  // Spec 0047: la página de cada tour usa el tema de su turno; la nocturna, entera.
  const theme = kind === TourKind.Night ? 'theme-night theme-page-night' : '';
  const name = locale === 'es' ? tour.name_es : tour.name_en;

  // Spec 0047: en pausa solo se ve el nombre y el aviso, nunca textos, precios ni fechas.
  if (tour.status !== TourStatus.Active) {
    return (
      <article className={`${theme} ${styles.page}`}>
        <header className={styles.hero}>
          <div className={styles.heroContent}>
            <div className={styles.tags}>
              <ShiftBadge shift={kind} />
            </div>
            <h1 className={styles.title}>{name}</h1>
            <p className={styles.description}>{t('tour-unavailable')}</p>
          </div>
        </header>
      </article>
    );
  }

  const [pricing, instances, salesEnabled] = await Promise.all([
    getTourPriceList(tour.id),
    getBookingCutoffHours().then((hours) => getUpcomingInstances(tour.id, hours)),
    isSalesEnabled(),
  ]);
  // Spec 0034: sin la información que prometen los términos, o sin datos del operador, el tour se
  // muestra pero no se puede reservar.
  const bookable = salesEnabled && isTourBookable(tour, pricing);

  const description = locale === 'es' ? tour.description_es : tour.description_en;
  const includes = locale === 'es' ? tour.includes_es : tour.includes_en;
  const excludes = locale === 'es' ? tour.excludes_es : tour.excludes_en;
  const requirements = locale === 'es' ? tour.requirements_es : tour.requirements_en;
  const meetingPoint = locale === 'es' ? tour.meeting_point_es : tour.meeting_point_en;
  const difficultyKey = `tours-difficulty-${tour.difficulty}` as const;

  // "Qué incluye" siempre se muestra; lo que no incluye y los requisitos, solo si tienen texto.
  const sections = [
    { title: t('detail-includes'), body: includes },
    ...(excludes.trim() ? [{ title: t('detail-excludes'), body: excludes }] : []),
    ...(requirements.trim() ? [{ title: t('detail-requirements'), body: requirements }] : []),
  ];

  return (
    <article className={`${theme} ${styles.page}`}>
      <header className={`${styles.hero} ${tour.cover_image_url ? styles.heroWithImage : ''}`}>
        {tour.cover_image_url && (
          <img
            src={tour.cover_image_url}
            alt={name}
            className={styles.cover}
            fetchPriority="high"
            decoding="async"
          />
        )}
        <div className={styles.heroContent}>
          <div className={`bv-fade ${styles.tags}`}>
            <ShiftBadge shift={kind} />
            <span className={styles.tag}>
              <Mountain aria-hidden="true" size={14} />
              <span className="bv-sr-only">{`${t('detail-difficulty')}: `}</span>
              {t(difficultyKey)}
            </span>
            <span className={styles.tag}>
              <Clock aria-hidden="true" size={14} />
              <span className="bv-sr-only">{`${t('detail-duration')}: `}</span>
              {t('tours-duration', { n: tour.duration_minutes })}
            </span>
          </div>
          <h1 className={styles.title}>
            <span className="bv-line">
              <span>{name}</span>
            </span>
          </h1>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.mainCol}>
          <p className={`bv-rise ${styles.description}`}>{description}</p>

          <div className={styles.sectionGrid}>
            {sections.map((section) => (
              <section key={section.title} className={`bv-reveal ${styles.section}`}>
                <h2 className={styles.sectionTitle}>{section.title}</h2>
                <p className={styles.prose}>{section.body}</p>
              </section>
            ))}
          </div>

          <section className={`bv-reveal ${styles.meeting}`}>
            <MapPin aria-hidden="true" size={22} className={styles.meetingIcon} />
            <div>
              <h2 className={styles.sectionTitle}>{t('detail-meeting-point')}</h2>
              <p className={styles.prose}>{meetingPoint}</p>
            </div>
          </section>

          <section className={`bv-reveal ${styles.priceCard}`}>
            <h2 className={styles.cardTitle}>{t('detail-prices')}</h2>
            <PriceList pricing={pricing} />
            {tour.child_age_min !== null && tour.child_age_max !== null && (
              <p className={styles.note}>
                {t('detail-child-ages', { min: tour.child_age_min, max: tour.child_age_max })}
              </p>
            )}
          </section>
        </div>

        <aside className={styles.aside}>
          <section className={styles.bookingCard}>
            <h2 className={styles.cardTitle}>{t('detail-availability')}</h2>
            {bookable ? (
              <AvailabilityCalendar
                departures={toCalendarDepartures(instances, locale, pricing, kind)}
                today={crDate()}
                tourKind={kind}
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
