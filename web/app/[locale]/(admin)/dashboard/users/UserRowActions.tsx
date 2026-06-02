'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { resendInvite, setActive } from '@/lib/users/actions';
import { UserRole } from '@shared/constants/enums';
import type { UserActionResult } from '@/lib/users/types';
import styles from './users.module.css';

type Props = { id: string; role: UserRole; active: boolean; isSelf: boolean };

export function UserRowActions({ id, role, active, isSelf }: Props) {
  const t = useTranslations('users');
  const [pending, startTransition] = useTransition();

  function errorText(result: Extract<UserActionResult, { ok: false }>) {
    const key = `errors.${result.error}`;
    return t.has(key) ? t(key) : t('errors.generic');
  }

  function onToggle() {
    if (active && !window.confirm(t('deactivate-confirm'))) return;
    startTransition(async () => {
      const result = await setActive(id, !active);
      if (!result.ok) window.alert(errorText(result));
    });
  }

  function onResend() {
    startTransition(async () => {
      const result = await resendInvite(id);
      window.alert(result.ok ? t('invite-resent') : errorText(result));
    });
  }

  return (
    <div className={styles.rowActions}>
      <button
        type="button"
        className={active ? styles.deactivateBtn : styles.reactivateBtn}
        onClick={onToggle}
        disabled={pending || (isSelf && active)}
      >
        {active ? t('deactivate') : t('reactivate')}
      </button>
      {role !== UserRole.Guide && active && (
        <button type="button" className={styles.resendBtn} onClick={onResend} disabled={pending}>
          {t('resend-invite')}
        </button>
      )}
    </div>
  );
}
