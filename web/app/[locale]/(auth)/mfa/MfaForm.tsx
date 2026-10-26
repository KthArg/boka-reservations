'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { startMfaEnrollmentAction, verifyMfaAction } from '@/lib/auth/mfa-actions';
import { MfaError, type MfaEnrollment } from '@/lib/auth/mfa-types';
import styles from './page.module.css';

type Props = { mode: 'enroll' | 'challenge'; factorId: string | undefined; redirectTo: string };

/** Código de 6 dígitos de la app autenticadora; en el enrolamiento, antes el QR y la clave. */
export function MfaForm({ mode, factorId, redirectTo }: Props) {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(verifyMfaAction, null);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);

  // El factor se crea al abrir la pantalla, no en el render del servidor (un prefetch del GET no
  // debe crear factores).
  useEffect(() => {
    if (mode === 'enroll') void startMfaEnrollmentAction().then(setEnrollment);
  }, [mode]);

  // Otra pestaña terminó el enrolamiento: con el factor ya verificado, toca pedir el código.
  const otherTabEnrolled =
    enrollment !== null && !enrollment.ok && enrollment.error === MfaError.HasFactor;
  useEffect(() => {
    if (otherTabEnrolled) window.location.reload();
  }, [otherTabEnrolled]);

  if (mode === 'enroll' && !enrollment)
    return <p className={styles.description}>{t('mfa-loading')}</p>;
  if (enrollment && !enrollment.ok) {
    return <p className={styles.error}>{t(`mfa-errors.${enrollment.error}`)}</p>;
  }
  const activeFactorId = enrollment?.ok ? enrollment.factorId : factorId;

  return (
    <form action={action} className={styles.form}>
      {enrollment?.ok && (
        <div className={styles.enroll}>
          {/* QR de Supabase (data: URI en SVG); la CSP admite img-src data:. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrollment.qrCode}
            alt={t('mfa-qr-alt')}
            className={styles.qr}
            width={180}
            height={180}
          />
          <p className={styles.secretLabel}>{t('mfa-secret-label')}</p>
          <code className={styles.secret}>{enrollment.secret}</code>
        </div>
      )}

      <input type="hidden" name="factorId" value={activeFactorId ?? ''} />
      <input type="hidden" name="redirectTo" value={redirectTo} />

      {state?.error && <p className={styles.error}>{t(`mfa-errors.${state.error}`)}</p>}

      <label className={styles.label}>
        {t('mfa-code')}
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
          className={styles.input}
        />
      </label>

      <button type="submit" className={styles.submit} disabled={pending || !activeFactorId}>
        {t('mfa-submit')}
      </button>
    </form>
  );
}
