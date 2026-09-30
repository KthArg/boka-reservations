import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { TourWithMinPrice } from '@/lib/public/tours';
import { ShiftBadge } from '@/components/public/ShiftBadge/ShiftBadge';
import styles from './TourCard.module.css';

type Props = { tour: TourWithMinPrice; priority?: boolean };

export function TourCard({ tour, priority = false }: Props) {
  const locale = useLocale();
  const t = useTranslations('public');

  const name = locale === 'es' ? tour.name_es : tour.name_en;
  const difficultyKey = `tours-difficulty-${tour.difficulty}` as const;
  const durationText = t('tours-duration', { n: tour.duration_minutes });
  const priceText = tour.min_price_usd
    ? t('tours-from-price', { price: tour.min_price_usd })
    : t('tours-no-price');

  // Spec 0042: los tours de noche usan el tema nocturno de la landing.
  const theme = tour.shift === 'night' ? 'theme-night' : '';

  return (
    <Link href={`/tours/${tour.slug}`} className={`${theme} ${styles.card}`}>
      <div className={styles.imageWrapper}>
        {tour.cover_image_url ? (
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
        {tour.shift ? <ShiftBadge shift={tour.shift} className={styles.shift} /> : null}
      </div>
      <div className={styles.body}>
        <h2 className={styles.name}>{name}</h2>
        <div className={styles.meta}>
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
