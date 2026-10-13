import type { FixedTour } from '@/lib/public/tours';
import { TourPanel } from './TourPanel';
import styles from './TourDiptych.module.css';

type Props = { tours: FixedTour[] };

/** Portada partida (spec 0047): el día a la izquierda y la noche a la derecha; apiladas en móvil. */
export function TourDiptych({ tours }: Props) {
  return (
    <ul className={styles.diptych}>
      {tours.map((tour, i) => (
        <li
          key={tour.kind}
          className={`bv-rise ${styles.half}`}
          style={{ '--i': i * 2 } as React.CSSProperties}
        >
          <TourPanel tour={tour} index={i} />
        </li>
      ))}
    </ul>
  );
}
