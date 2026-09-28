'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { correctBookingContact } from '@/lib/privacy/contact-action';
import styles from '../bookings.module.css';

type Props = { bookingId: string; name: string; email: string };

/**
 * Corrección de nombre y correo a pedido del turista (aviso de privacidad, P7; spec 0036). Solo
 * admin. Estado controlado: React 19 hace form.reset() tras la action y borraría lo escrito.
 */
export function ContactCorrectionForm({ bookingId, name, email }: Props) {
  const t = useTranslations('privacy');
  const [state, action, pending] = useActionState(correctBookingContact, null);
  const [values, setValues] = useState({ name, email });

  return (
    <form action={action} className={styles.operationForm}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <label className={styles.operationField}>
        <span>{t('contact-name')}</span>
        <input
          name="name"
          required
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        />
      </label>
      <label className={styles.operationField}>
        <span>{t('contact-email')}</span>
        <input
          name="email"
          type="email"
          required
          value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
        />
      </label>
      {state && !state.ok ? (
        <p className={styles.formError} role="alert">
          {t(`contact-error-${state.error}`)}
        </p>
      ) : null}
      {state?.ok ? <p className={styles.empty}>{t('contact-saved')}</p> : null}
      <button type="submit" className={styles.primaryBtn} disabled={pending}>
        {t('contact-submit')}
      </button>
    </form>
  );
}
