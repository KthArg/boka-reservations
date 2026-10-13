import { useTranslations } from 'next-intl';
import { ArrowRight, Moon, Sun } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { TourKind } from '@shared/constants/enums';
import styles from './OtherTourLink.module.css';

const ICON = { [TourKind.Day]: Sun, [TourKind.Night]: Moon } as const;

/**
 * Cierre de la página de un tour (spec 0047): invita al otro tour, con el tema de ese otro tour,
 * y deja a mano la portada con los dos.
 */
export function OtherTourLink({ current }: { current: TourKind }) {
  const t = useTranslations('public');
  const other = current === TourKind.Day ? TourKind.Night : TourKind.Day;
  const Icon = ICON[other];
  const theme = other === TourKind.Night ? `theme-night ${styles.night}` : styles.day;

  return (
    <nav className={styles.nav} aria-label={t('other-tour-label')}>
      <Link href={`/tours/${other}`} className={`${theme} ${styles.other}`}>
        <Icon aria-hidden="true" size={22} strokeWidth={2} />
        <span className={styles.label}>{t(`other-tour-${other}`)}</span>
        <ArrowRight aria-hidden="true" size={20} className={styles.arrow} />
      </Link>
      <Link href="/tours" className={styles.all}>
        {t('other-tour-all')}
      </Link>
    </nav>
  );
}
