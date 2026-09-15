'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { handleNextAction } from '@/lib/payments/card-vault';
import styles from '../booking.module.css';

type Props = { paymentIntentId: string };

type State = 'idle' | 'done' | 'failed';

/**
 * Abre el desafío 3DS del banco con la librería de OnvoPay (spec 0029 §5.7). Con un gesto del
 * turista, para que el navegador no bloquee el modal. El resultado solo informa: el cobro lo
 * asientan el webhook o watch-charges, que leen el estado final del intent.
 */
export function AuthenticateCharge({ paymentIntentId }: Props) {
  const t = useTranslations('cancellation');
  const [state, setState] = useState<State>('idle');
  const [pending, startTransition] = useTransition();

  if (state === 'done') return <p className={styles.refundYes}>{t('authenticate-done')}</p>;

  function onStart() {
    startTransition(async () => {
      const result = await handleNextAction(paymentIntentId);
      setState(result.ok ? 'done' : 'failed');
    });
  }

  return (
    <div>
      {state === 'failed' ? (
        <p className={styles.error} role="alert">
          {t('authenticate-failed')}
        </p>
      ) : null}
      <button type="button" className={styles.primaryButton} onClick={onStart} disabled={pending}>
        {pending ? t('authenticate-working') : t('authenticate-start')}
      </button>
    </div>
  );
}
