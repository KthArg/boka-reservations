'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CHECKOUT_ACCEPTED_VALUE, CheckoutLegalField } from '@shared/constants/legal';
import styles from './CheckoutForm.module.css';

type CheckboxProps = {
  name: string;
  children: ReactNode;
};

/**
 * Casilla obligatoria. `defaultChecked` ligado al estado: React 19 resetea el form tras la
 * action y, ante un error, el turista perdería la tilde.
 */
function RequiredCheckbox({ name, children }: CheckboxProps) {
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
      <RequiredCheckbox name={CheckoutLegalField.Terms}>
        {t.rich('terms-label', { terms: link('terms') })}
      </RequiredCheckbox>
      <RequiredCheckbox name={CheckoutLegalField.PrivacyConsent}>
        {t.rich('privacy-consent-label', { privacy: link('privacy') })}
      </RequiredCheckbox>
    </section>
  );
}
