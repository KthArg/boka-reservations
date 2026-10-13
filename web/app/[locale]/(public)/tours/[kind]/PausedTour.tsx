import { OtherTourLink } from '@/components/public/OtherTourLink/OtherTourLink';
import { ShiftBadge } from '@/components/public/ShiftBadge/ShiftBadge';
import type { TourKind } from '@shared/constants/enums';
import styles from './tour.module.css';

type Props = { kind: TourKind; name: string; notice: string; theme: string };

/** Página de un tour en pausa (spec 0047): solo el nombre y el aviso, nunca textos ni fechas. */
export function PausedTour({ kind, name, notice, theme }: Props) {
  return (
    <article className={`${theme} ${styles.page}`}>
      <header className={styles.hero} data-kind={kind}>
        <span className={styles.astro} aria-hidden="true" />
        <div className={styles.heroContent}>
          <div className={styles.tags}>
            <ShiftBadge shift={kind} />
          </div>
          <h1 className={styles.title}>{name}</h1>
          <p className={styles.description}>{notice}</p>
        </div>
      </header>
      <OtherTourLink current={kind} />
    </article>
  );
}
