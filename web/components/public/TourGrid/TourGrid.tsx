import type { TourWithMinPrice } from '@/lib/public/tours';
import { TourCard } from '@/components/public/TourCard/TourCard';
import styles from './TourGrid.module.css';

type Props = { tours: TourWithMinPrice[] };

export function TourGrid({ tours }: Props) {
  return (
    <ul className={styles.grid}>
      {tours.map((tour) => (
        <li key={tour.id}>
          <TourCard tour={tour} />
        </li>
      ))}
    </ul>
  );
}
