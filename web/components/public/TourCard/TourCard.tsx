import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { TourWithMinPrice } from '@/lib/public/tours';
import styles from './TourCard.module.css';

type Props = { tour: TourWithMinPrice };

export function TourCard({ tour }: Props) {
  const locale = useLocale();
  const t = useTranslations('public');

  const name = locale === 'es' ? tour.name_es : tour.name_en;
  const difficultyKey = `tours-difficulty-${tour.difficulty}` as const;
  const durationText = t('tours-duration', { n: tour.duration_minutes });
  const priceText = tour.min_price_usd
    ? t('tours-from-price', { price: tour.min_price_usd })
    : t('tours-no-price');

  return (
    <Link href={`/tours/${tour.slug}`} className={styles.card}>
      <div className={styles.imageWrapper}>
        {tour.cover_image_url ? (
          <img src={tour.cover_image_url} alt={name} className={styles.image} />
        ) : (
          <div className={styles.placeholder} aria-hidden="true" />
        )}
      </div>
      <div className={styles.body}>
        <h2 className={styles.name}>{name}</h2>
        <div className={styles.meta}>
          <span className={styles.badge}>{t(difficultyKey)}</span>
          <span className={styles.metaItem}>{durationText}</span>
        </div>
        <p className={styles.price}>{priceText}</p>
      </div>
    </Link>
  );
}
