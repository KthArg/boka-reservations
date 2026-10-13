'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useDialogs } from '@/components/dialogs/DialogProvider';
import { pauseTour, resumeTour } from '@/lib/tours/status-action';
import { Icon } from '@/components/admin/icons';
import type { TourKind } from '@shared/constants/enums';
import styles from './TourStatusButton.module.css';

type Props = { kind: TourKind; paused: boolean };

/**
 * Pausa o reanuda la venta de un tour fijo (spec 0047). Pausar pide confirmación porque saca el
 * tour de la venta; reanudar puede rechazarse y el admin tiene que ver qué le falta al tour.
 */
export function TourStatusButton({ kind, paused }: Props) {
  const t = useTranslations('tours');
  const { confirm, alert } = useDialogs();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function onClick() {
    if (!paused && !(await confirm(t('confirm-pause')))) return;
    startTransition(async () => {
      const result = paused ? await resumeTour(kind) : await pauseTour(kind);
      if (!result.ok) {
        alert(t(`errors.${result.error}`));
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      className={paused ? styles.resume : styles.pause}
      onClick={onClick}
      disabled={pending}
      aria-busy={pending}
    >
      <Icon name={paused ? 'resume' : 'pause'} size={15} />
      {t(paused ? 'resume-sales' : 'pause-sales')}
    </button>
  );
}
