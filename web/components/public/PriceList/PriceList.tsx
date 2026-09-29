import { useTranslations } from 'next-intl';
import type { PublicPricing } from '@/lib/public/tours';
import { MONTH_KEYS } from '@/lib/public/calendar-keys';
import styles from './PriceList.module.css';

type Props = { pricing: PublicPricing[] };

const TICKET_ORDER = ['adult', 'child', 'student'];
const TICKET_KEY_MAP: Record<string, 'ticket-adult' | 'ticket-child' | 'ticket-student'> = {
  adult: 'ticket-adult',
  child: 'ticket-child',
  student: 'ticket-student',
};

/**
 * Tarifas del tour (spec 0040): por tiquete, el precio base y cada temporada con sus fechas
 * ("Alta · 15 de diciembre al 30 de abril"). Las temporadas se repiten cada año; el precio de una
 * salida concreta lo muestra el calendario.
 */
export function PriceList({ pricing }: Props) {
  const t = useTranslations('public');

  if (pricing.length === 0) return null;

  const monthName = (m: number) => t(MONTH_KEYS[m - 1]);
  const range = (start: string, end: string) => {
    const [startMonth, startDay] = start.split('-').map(Number);
    const [endMonth, endDay] = end.split('-').map(Number);
    return t('price-season-range', {
      startDay,
      startMonth: monthName(startMonth),
      endDay,
      endMonth: monthName(endMonth),
    });
  };

  const sorted = [...pricing].sort(
    (a, b) =>
      TICKET_ORDER.indexOf(a.ticket_type) - TICKET_ORDER.indexOf(b.ticket_type) ||
      (a.season_start ?? '').localeCompare(b.season_start ?? ''),
  );

  return (
    <ul className={styles.list}>
      {sorted.map((p) => (
        <li key={p.id} className={styles.row}>
          <span className={styles.type}>
            {t(TICKET_KEY_MAP[p.ticket_type] ?? 'ticket-adult')}
            {p.season_start && p.season_end ? (
              <span className={styles.seasonRange}>
                {`${p.season_label ?? ''} · ${range(p.season_start, p.season_end)}`}
              </span>
            ) : null}
          </span>
          <span className={styles.price}>${p.price_usd} USD</span>
        </li>
      ))}
    </ul>
  );
}
