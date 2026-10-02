'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useDialogs } from '@/components/dialogs/DialogProvider';
import { decideDeparture } from '@/lib/departures/decision-action';
import {
  DepartureDecision as Decision,
  DepartureDecisionError,
} from '@shared/constants/departures';
import styles from './departures.module.css';

// Los errores que cambian lo que la persona tiene que hacer: esperar unos minutos, recargar
// porque alguien más ya decidió, o cancelar por otra causa. El resto comparte el genérico.
const ERROR_MESSAGE: Partial<Record<DepartureDecisionError, string>> = {
  [DepartureDecisionError.AlreadyResolved]: 'decision-already-resolved',
  [DepartureDecisionError.CaptureInProgress]: 'decision-capture-in-progress',
  [DepartureDecisionError.MinimumTooLate]: 'decision-minimum-too-late',
};

type Props = { instanceId: string };

/**
 * Los dos botones de la bandeja (spec 0033 §5.5). Cancelar pide confirmación porque cancela la
 * salida entera y reembolsa a quien ya haya pagado; confirmar la devuelve al ciclo de cobro.
 */
export function DepartureDecision({ instanceId }: Props) {
  const t = useTranslations('departures');
  const { confirm, alert } = useDialogs();
  const [pending, startTransition] = useTransition();

  async function decide(decision: typeof Decision.Confirm | typeof Decision.Cancel) {
    const confirming = decision === Decision.Confirm;
    const ask = t(confirming ? 'confirm-ask' : 'cancel-ask');
    if (!(await confirm(ask, { tone: confirming ? 'default' : 'danger' }))) return;
    startTransition(async () => {
      const result = await decideDeparture(instanceId, decision);
      if (!result.ok) alert(t(ERROR_MESSAGE[result.error] ?? 'decision-error'));
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
