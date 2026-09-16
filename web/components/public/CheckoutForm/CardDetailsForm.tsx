'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  completeDeferredCheckoutAction,
  type DeferredCheckoutStarted,
} from '@/lib/booking/deferred-checkout-action';
import {
  CheckoutErrorKey,
  RESTART_CHECKOUT_ERRORS,
  type CheckoutErrorKeyValue,
} from '@/lib/booking/deferred-checkout-errors';
import { EMPTY_CARD, toCardInput, type CardFormValues } from '@/lib/payments/card-input';
import { CardTokenizationError, tokenizeCard } from '@/lib/payments/card-vault';
import { formatMoneyCents } from '@/lib/format/money';
import { CardFields } from './CardFields';
import styles from './CheckoutForm.module.css';
import deferredStyles from './DeferredCheckout.module.css';

type Props = {
  checkout: DeferredCheckoutStarted;
  /** Vuelve al paso 1: la reserva temporal venció o el monto autorizado ya no vale. */
  onRestart: () => void;
};

function tokenizationErrorKey(err: unknown): CheckoutErrorKeyValue {
  return err instanceof CardTokenizationError && err.failure === 'rejected'
    ? CheckoutErrorKey.CardInvalid
    : CheckoutErrorKey.Generic;
}

/**
 * Checkout diferido, paso 2 (spec 0029 §5.2): la tarjeta se tokeniza en el navegador contra
 * OnvoPay y al servidor solo viaja el paymentMethodId. El formulario no tiene `action` y sus
 * inputs no tienen `name`: los datos de la tarjeta no pueden terminar en un POST propio.
 */
export function CardDetailsForm({ checkout, onRestart }: Props) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const router = useRouter();
  const [card, setCard] = useState<CardFormValues>(EMPTY_CARD);
  const [mandateAccepted, setMandateAccepted] = useState(false);
  const [error, setError] = useState<CheckoutErrorKeyValue | null>(null);
  const [pending, startTransition] = useTransition();

  const amount = formatMoneyCents(checkout.totalAmountCents, checkout.currency, locale);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = toCardInput(card);
    if (!parsed) {
      setError(CheckoutErrorKey.CardInvalid);
      return;
    }

    setError(null);
    startTransition(async () => {
      let paymentMethodId: string;
      try {
        paymentMethodId = await tokenizeCard(parsed, checkout.customerId);
      } catch (err) {
        setError(tokenizationErrorKey(err));
        return;
      }

      // Una respuesta perdida (red caída) rechaza la promesa: el turista ve un error y, si la
      // reserva ya se creó, reintentar devuelve la misma reserva.
      const result = await completeDeferredCheckoutAction({
        holdId: checkout.holdId,
        paymentMethodId,
        expectedAmountCents: checkout.totalAmountCents,
        fields: checkout.fields,
      }).catch(() => null);
      if (!result) {
        setError(CheckoutErrorKey.Generic);
        return;
      }
      if ('error' in result) {
        setError(result.error);
        return;
      }
      router.push(`/${locale}/checkout/success?booking=${result.bookingId}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('card-section')}</h2>
        <CardFields value={card} onChange={setCard} disabled={pending} />
        <label className={deferredStyles.mandate}>
          <input
            type="checkbox"
            checked={mandateAccepted}
            onChange={(e) => setMandateAccepted(e.target.checked)}
            required
          />
          <span>{t('card-mandate', { amount })}</span>
        </label>
      </section>

      {error && (
        <div role="alert">
          <p className={styles.error}>{t(error)}</p>
          {RESTART_CHECKOUT_ERRORS.has(error) && (
            <button type="button" onClick={onRestart} className={deferredStyles.restart}>
              {t('deferred-restart')}
            </button>
          )}
        </div>
      )}

      <button type="submit" disabled={pending || !mandateAccepted} className={styles.submit}>
        {pending ? t('card-saving') : t('card-submit')}
      </button>
    </form>
  );
}
