'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { decideDeparture } from '@/lib/departures/decision-action';
import {
  DepartureDecision as Decision,
  DepartureDecisionError,
} from '@shared/constants/departures';
import styles from './departures.module.css';

// Los dos errores que cambian lo que la persona tiene que hacer: esperar unos minutos, o
// recargar porque alguien más ya decidió. El resto comparte el mensaje genérico.
const ERROR_MESSAGE: Partial<Record<DepartureDecisionError, string>> = {
  [DepartureDecisionError.AlreadyResolved]: 'decision-already-resolved',
  [DepartureDecisionError.CaptureInProgress]: 'decision-capture-in-progress',
};

type Props = { instanceId: string };

/**
 * Los dos botones de la bandeja (spec 0033 §5.5). Cancelar pide confirmación porque cancela la
 * salida entera y reembolsa a quien ya haya pagado; confirmar la devuelve al ciclo de cobro.
 */
export function DepartureDecision({ instanceId }: Props) {
  const t = useTranslations('departures');
  const [pending, startTransition] = useTransition();

  function decide(decision: typeof Decision.Confirm | typeof Decision.Cancel) {
    if (!window.confirm(t(decision === Decision.Confirm ? 'confirm-ask' : 'cancel-ask'))) return;
    startTransition(async () => {
      const result = await decideDeparture(instanceId, decision);
      if (!result.ok) window.alert(t(ERROR_MESSAGE[result.error] ?? 'decision-error'));
    });
  }

  return (
    <div className={styles.decision}>
      <button
        type="button"
        className={styles.confirmButton}
        disabled={pending}
        onClick={() => decide(Decision.Confirm)}
      >
        {t('confirm')}
      </button>
      <button
        type="button"
        className={styles.cancelButton}
        disabled={pending}
        onClick={() => decide(Decision.Cancel)}
      >
        {t('cancel')}
      </button>
    </div>
  );
}
