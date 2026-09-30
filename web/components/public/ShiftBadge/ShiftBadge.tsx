import { useTranslations } from 'next-intl';
import { Moon, Sun, SunMoon } from 'lucide-react';
import type { TourShift } from '@/lib/public/shift';
import styles from './ShiftBadge.module.css';

const ICON = { day: Sun, night: Moon, both: SunMoon } as const;
const LABEL = { day: 'shift-day', night: 'shift-night', both: 'shift-both' } as const;

/** Etiqueta de turno de un tour o una salida (spec 0042): sol, luna o los dos. */
export function ShiftBadge({ shift, className }: { shift: TourShift; className?: string }) {
  const t = useTranslations('public');
  const Icon = ICON[shift];
  return (
    <span className={`${styles.badge} ${styles[shift]} ${className ?? ''}`}>
      <Icon aria-hidden="true" size={14} strokeWidth={2.2} />
      {t(LABEL[shift])}
    </span>
  );
}
