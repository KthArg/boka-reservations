'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './CheckoutForm.module.css';

/**
 * Consentimiento de privacidad y términos del checkout (spec 0021). `defaultChecked` ligado al
 * estado: React 19 resetea el form tras la action y, ante un error, el turista perdería la tilde.
 */
export function ConsentField() {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const [accepted, setAccepted] = useState(false);

  return (
    <section className={styles.section}>
      <label className={styles.consent}>
        <input
          type="checkbox"
          name="consent"
          value="accepted"
          required
          defaultChecked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className={styles.consentCheckbox}
        />
        <span className={styles.consentText}>
          {t.rich('consent-label', {
            privacy: (chunks) => (
              <a
                href={`/${locale}/privacy`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.consentLink}
              >
                {chunks}
              </a>
            ),
            terms: (chunks) => (
              <a
                href={`/${locale}/terms`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.consentLink}
              >
                {chunks}
              </a>
            ),
          })}
        </span>
      </label>
    </section>
  );
}
