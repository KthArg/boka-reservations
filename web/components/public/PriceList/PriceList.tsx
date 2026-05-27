import { useTranslations } from 'next-intl';
import type { PublicPricing } from '@/lib/public/tours';
import styles from './PriceList.module.css';

type Props = { pricing: PublicPricing[] };

const TICKET_KEY_MAP: Record<string, 'ticket-adult' | 'ticket-child' | 'ticket-student'> = {
  adult: 'ticket-adult',
  child: 'ticket-child',
  student: 'ticket-student',
};

export function PriceList({ pricing }: Props) {
  const t = useTranslations('public');

  if (pricing.length === 0) return null;

  return (
    <ul className={styles.list}>
      {pricing.map((p) => (
        <li key={p.id} className={styles.row}>
          <span className={styles.type}>{t(TICKET_KEY_MAP[p.ticket_type] ?? 'ticket-adult')}</span>
          <span className={styles.price}>${p.price_usd} USD</span>
        </li>
      ))}
    </ul>
  );
}
