'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useDialogs } from '@/components/dialogs/DialogProvider';
import { keepDepartureAction } from '@/lib/operations/departure-actions';
import styles from './departures.module.css';

/** Mantener una salida bajo el mínimo (spec 0035): el proceso del mínimo ya no la cancela. */
export function KeepDepartureButton({ instanceId }: { instanceId: string }) {
  const t = useTranslations('operations');
  const { confirm, alert } = useDialogs();
  const [pending, startTransition] = useTransition();

  async function keep() {
    if (!(await confirm(t('keep-ask')))) return;
    startTransition(async () => {
      const result = await keepDepartureAction(instanceId);
      if (!result.ok) alert(t(`error-${result.error}`));
    });
  }

  return (
    <button type="button" className={styles.confirmButton} disabled={pending} onClick={keep}>
      {t('keep')}
    </button>
  );
}
