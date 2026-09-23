'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { refundFeeNoticeValues } from '@/lib/booking/refund-fee-notice';
import { CHECKOUT_ACCEPTED_VALUE, CheckoutLegalField } from '@shared/constants/legal';
import styles from './CheckoutForm.module.css';

type CheckboxProps = {
  name: string;
  children: ReactNode;
  /** Id de un texto que describe la casilla (el aviso de reembolso, spec 0032). */
  describedBy?: string;
};

const REFUND_NOTICE_ID = 'checkout-refund-fee-notice';

/**
 * Casilla obligatoria. `defaultChecked` ligado al estado: React 19 resetea el form tras la
 * action y, ante un error, el turista perdería la tilde.
 */
function RequiredCheckbox({ name, children, describedBy }: CheckboxProps) {
  const [accepted, setAccepted] = useState(false);

  return (
    <label className={styles.consent}>
      <input
        type="checkbox"
        name={name}
        value={CHECKOUT_ACCEPTED_VALUE}
        required
        defaultChecked={accepted}
        onChange={(e) => setAccepted(e.target.checked)}
        className={styles.consentCheckbox}
        aria-describedby={describedBy}
      />
      <span className={styles.consentText}>{children}</span>
    </label>
  );
}

/**
 * Aceptaciones legales del checkout (specs 0021 y 0031). Términos y tratamiento de datos van
 * en casillas separadas: el consentimiento sobre los datos dentro de un contrato debe ser una
 * cláusula específica e independiente (reglamento de la Ley 8968, art. 2.f).
 */
export function ConsentField() {
  const t = useTranslations('checkout');
  const locale = useLocale();
  // Política de reembolso menos comisión (spec 0032): solo con la cláusula activa en los términos.
  const refundNotice = refundFeeNoticeValues(locale);

  const link = (path: string) =>
    function LegalLink(chunks: ReactNode) {
      return (
        <a
          href={`/${locale}/${path}`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.consentLink}
        >
          {chunks}
        </a>
      );
    };

  return (
    <section className={styles.section}>
      <RequiredCheckbox
        name={CheckoutLegalField.Terms}
        describedBy={refundNotice ? REFUND_NOTICE_ID : undefined}
      >
        {t.rich('terms-label', { terms: link('terms') })}
      </RequiredCheckbox>
      {refundNotice ? (
        <p id={REFUND_NOTICE_ID} className={styles.consentNotice}>
          {t('refund-fee-notice', refundNotice)}
        </p>
      ) : null}
      <RequiredCheckbox name={CheckoutLegalField.PrivacyConsent}>
        {t.rich('privacy-consent-label', { privacy: link('privacy') })}
      </RequiredCheckbox>
    </section>
  );
}
