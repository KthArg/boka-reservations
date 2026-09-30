import type { TourWithMinPrice } from '@/lib/public/tours';
import { TourCard } from '@/components/public/TourCard/TourCard';
import styles from './TourGrid.module.css';

type Props = { tours: TourWithMinPrice[] };

/** Tope del escalonado de entrada: con muchos tours, las últimas tarjetas no esperan de más. */
const MAX_STAGGER_STEPS = 8;
/** Las primeras tarjetas cargan su foto de inmediato; el resto, al acercarse. */
const EAGER_CARDS = 2;

export function TourGrid({ tours }: Props) {
  return (
    <ul className={styles.grid}>
      {tours.map((tour, i) => (
        // Spec 0042: las tarjetas entran escalonadas.
        <li
          key={tour.id}
          className="bv-rise"
          style={{ '--i': Math.min(i, MAX_STAGGER_STEPS) } as React.CSSProperties}
        >
          <TourCard tour={tour} priority={i < EAGER_CARDS} />
        </li>
      ))}
    </ul>
  );
}
