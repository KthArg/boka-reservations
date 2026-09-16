'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { updateCardAction } from '@/lib/booking/card-update-action';
import { CardUpdateError, type CardUpdateErrorValue } from '@/lib/booking/card-update-errors';
import { EMPTY_CARD, toCardInput, type CardFormValues } from '@/lib/payments/card-input';
import { CardTokenizationError, tokenizeCard } from '@/lib/payments/card-vault';
import { CardFields } from '@/components/public/CheckoutForm/CardFields';
import styles from '../booking.module.css';

type Props = { token: string; customerId: string; amount: string };

type State = { kind: 'idle' } | { kind: 'done' } | { kind: 'error'; error: CardUpdateErrorValue };

function tokenizationError(err: unknown): CardUpdateErrorValue {
  return err instanceof CardTokenizationError && err.failure === 'rejected'
    ? CardUpdateError.CardInvalid
    : CardUpdateError.Generic;
}

/**
 * Formulario de la tarjeta nueva (spec 0029 §5.2): se tokeniza en el navegador contra OnvoPay y al
 * servidor solo viaja el paymentMethodId. Sin `action` ni `name` en los inputs.
 */
export function CardUpdateForm({ token, customerId, amount }: Props) {
  const t = useTranslations('cancellation');
  const [card, setCard] = useState<CardFormValues>(EMPTY_CARD);
  const [mandateAccepted, setMandateAccepted] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  if (state.kind === 'done') return <p className={styles.refundYes}>{t('card-updated')}</p>;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = toCardInput(card);
    if (!parsed || !mandateAccepted) {
      setState({ kind: 'error', error: CardUpdateError.CardInvalid });
      return;
    }
    setState({ kind: 'idle' });
    startTransition(async () => {
      let paymentMethodId: string;
      try {
        paymentMethodId = await tokenizeCard(parsed, customerId);
      } catch (err) {
        setState({ kind: 'error', error: tokenizationError(err) });
        return;
      }
      const result = await updateCardAction({
        token,
        paymentMethodId,
        mandateAccepted: true,
      }).catch(() => null);
      if (!result) setState({ kind: 'error', error: CardUpdateError.Generic });
      else setState(result.ok ? { kind: 'done' } : { kind: 'error', error: result.error });
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <CardFields value={card} onChange={setCard} disabled={pending} />
      <label className={styles.mandate}>
        <input
          type="checkbox"
          checked={mandateAccepted}
          onChange={(e) => setMandateAccepted(e.target.checked)}
          required
        />
        <span>{t('card-mandate', { amount })}</span>
      </label>
      {state.kind === 'error' ? (
        <p className={styles.error} role="alert">
          {t(state.error)}
        </p>
      ) : null}
      <div className={styles.formActions}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending || !mandateAccepted}
        >
          {pending ? t('card-saving') : t('card-submit')}
        </button>
      </div>
    </form>
  );
}
