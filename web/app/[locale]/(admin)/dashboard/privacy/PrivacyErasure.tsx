'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  anonymizeCustomerByEmail,
  previewCustomerErasure,
  type AnonymizeResult,
} from '@/lib/privacy/anonymize-action';
import type { ErasurePreview } from '@/lib/privacy/preview';
import styles from './privacy.module.css';

/**
 * Borrado a pedido (spec 0036): primero la vista previa, sin datos personales, y después el
 * borrado. Con dinero pendiente de devolverle a la persona, el botón no aparece.
 */
export function PrivacyErasure() {
  const t = useTranslations('privacy');
  const [email, setEmail] = useState('');
  const [preview, setPreview] = useState<ErasurePreview | null>(null);
  const [result, setResult] = useState<AnonymizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function search() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const outcome = await previewCustomerErasure(email);
      if (outcome.ok) setPreview(outcome.preview);
      else setError(t(`error-${outcome.error}`));
    });
  }

  function erase() {
    if (!window.confirm(t('erase-ask', { email }))) return;
    startTransition(async () => {
      const outcome = await anonymizeCustomerByEmail(email);
      if (outcome.ok) {
        setResult(outcome.result);
        setPreview(null);
      } else {
        setError(t(`error-${outcome.error}`));
      }
    });
  }

  return (
    <section className={styles.card}>
      <label className={styles.field}>
        <span>{t('email-label')}</span>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setPreview(null);
          }}
          disabled={pending}
        />
      </label>
      <button
        type="button"
        className={styles.secondaryBtn}
        onClick={search}
        disabled={!email || pending}
      >
        {t('search')}
      </button>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {preview ? <PreviewSummary preview={preview} onErase={erase} pending={pending} /> : null}

      {result ? (
        <p className={styles.success} role="status">
          {t('erase-done', { anonymized: result.anonymizedCount, deleted: result.deletedCount })}
        </p>
      ) : null}
    </section>
  );
}

type SummaryProps = { preview: ErasurePreview; onErase: () => void; pending: boolean };

function PreviewSummary({ preview, onErase, pending }: SummaryProps) {
  const t = useTranslations('privacy');
  const tBookings = useTranslations('bookings');

  if (preview.total === 0) return <p className={styles.note}>{t('preview-empty')}</p>;

  return (
    <div className={styles.preview}>
      <p className={styles.note}>{t('preview-total', { total: preview.total })}</p>
      <ul className={styles.list}>
        {Object.entries(preview.byStatus).map(([status, count]) => (
          <li key={status}>
            {tBookings(`status-${status}`)}: {count}
          </li>
        ))}
      </ul>
      <p className={styles.note}>{t('preview-what-happens')}</p>
      {preview.upcoming > 0 ? (
        <p className={styles.warning}>{t('preview-upcoming', { count: preview.upcoming })}</p>
      ) : null}
      {preview.pendingRefunds > 0 ? (
        <p className={styles.warning}>{t('preview-pending-refund')}</p>
      ) : (
        <button type="button" className={styles.dangerBtn} onClick={onErase} disabled={pending}>
          {t('erase')}
        </button>
      )}
    </div>
  );
}
