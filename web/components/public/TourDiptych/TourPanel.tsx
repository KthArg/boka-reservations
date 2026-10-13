import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Clock, Moon, Sun } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { FixedTour } from '@/lib/public/tours';
import { TourKind, TourStatus } from '@shared/constants/enums';
import styles from './TourDiptych.module.css';

type Props = { tour: FixedTour; index: number };

const ICON = { [TourKind.Day]: Sun, [TourKind.Night]: Moon } as const;

/**
 * Una mitad de la portada (spec 0047 §5.4): el tour diurno en claro o el nocturno en tema noche.
 * En pausa solo anuncia que no está disponible: ni foto, ni textos, ni precio, ni enlace.
 */
export function TourPanel({ tour, index }: Props) {
  const locale = useLocale();
  const t = useTranslations('public');
  const Icon = ICON[tour.kind];
  const night = tour.kind === TourKind.Night;
  const paused = tour.status !== TourStatus.Active;
  const photo = paused ? null : tour.cover_image_url;

  const name = locale === 'es' ? tour.name_es : tour.name_en;
  const nameId = `tour-${tour.kind}-name`;
  const metaId = `tour-${tour.kind}-meta`;
  const className = [
    styles.panel,
    night ? `theme-night ${styles.night}` : styles.day,
    photo ? styles.withPhoto : '',
    paused ? styles.paused : '',
  ].join(' ');

  const content = (
    <>
      {photo ? <img src={photo} alt="" className={styles.photo} decoding="async" /> : null}
      <span className={styles.astro} aria-hidden="true" />
      <p className={styles.kicker}>
        <span className={styles.index} aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
        <Icon aria-hidden="true" size={15} strokeWidth={2.2} />
        {t(`shift-${tour.kind}`)}
      </p>
      <div className={styles.copy}>
        <h2 id={nameId} className={styles.name}>
          {name}
        </h2>
        {paused ? (
          <p className={styles.unavailable}>{t('tour-unavailable')}</p>
        ) : (
          <>
            <p className={styles.tagline}>
              {locale === 'es' ? tour.description_es : tour.description_en}
            </p>
            <p id={metaId} className={styles.meta}>
              <span className={styles.metaItem}>
                <Clock aria-hidden="true" size={15} />
                {t('tours-duration', { n: tour.duration_minutes })}
              </span>
              <span className={styles.metaItem}>
                {tour.min_price_usd
                  ? t('tours-from-price', { price: tour.min_price_usd })
                  : t('tours-no-price')}
              </span>
            </p>
            <span className={styles.cta}>
              {t('tours-see-dates')}
              <ArrowRight aria-hidden="true" size={18} />
            </span>
          </>
        )}
      </div>
    </>
  );

  return paused ? (
    <div className={className}>{content}</div>
  ) : (
    // El enlace cubre toda la mitad: se anuncia con el nombre y los datos, no con todo el texto.
    <Link
      href={`/tours/${tour.kind}`}
      className={className}
      aria-labelledby={nameId}
      aria-describedby={metaId}
    >
      {content}
    </Link>
  );
}
