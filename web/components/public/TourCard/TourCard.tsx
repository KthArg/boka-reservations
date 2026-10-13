import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { FixedTour } from '@/lib/public/tours';
import { TourKind, TourStatus } from '@shared/constants/enums';
import { ShiftBadge } from '@/components/public/ShiftBadge/ShiftBadge';
import styles from './TourCard.module.css';

type Props = { tour: FixedTour; priority?: boolean };

export function TourCard({ tour, priority = false }: Props) {
  const locale = useLocale();
  const t = useTranslations('public');

  const name = locale === 'es' ? tour.name_es : tour.name_en;
  const difficultyKey = `tours-difficulty-${tour.difficulty}` as const;
  const durationText = t('tours-duration', { n: tour.duration_minutes });

  // Spec 0042: los tours de noche usan el tema nocturno de la landing.
  const theme = tour.kind === TourKind.Night ? 'theme-night' : '';
  // Spec 0047: en pausa solo se anuncia que no está disponible, sin precio.
  const paused = tour.status !== TourStatus.Active;
  const priceText = paused
    ? t('tour-unavailable')
    : tour.min_price_usd
      ? t('tours-from-price', { price: tour.min_price_usd })
      : t('tours-no-price');

  return (
    <Link href={`/tours/${tour.kind}`} className={`${theme} ${styles.card}`}>
      <div className={styles.imageWrapper}>
        {tour.cover_image_url && !paused ? (
          <img
            src={tour.cover_image_url}
            alt={name}
            className={styles.image}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
          />
        ) : (
          <div className={styles.placeholder} aria-hidden="true" />
        )}
        <ShiftBadge shift={tour.kind} className={styles.shift} />
      </div>
      <div className={styles.body}>
        <h2 className={styles.name}>{name}</h2>
        <div className={styles.meta} hidden={paused}>
          <span className={styles.badge}>{t(difficultyKey)}</span>
          <span className={styles.metaItem}>
            <Clock aria-hidden="true" size={14} />
            {durationText}
          </span>
        </div>
        <div className={styles.footer}>
          <p className={styles.price}>{priceText}</p>
          <span className={styles.arrow} aria-hidden="true">
            <ArrowUpRight size={18} />
          </span>
        </div>
      </div>
    </Link>
  );
}
