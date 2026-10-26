'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useDialogs } from '@/components/dialogs/DialogProvider';
import { resendInvite, resetMfa, setActive } from '@/lib/users/actions';
import { UserRole } from '@shared/constants/enums';
import type { UserActionResult } from '@/lib/users/types';
import { Icon } from '@/components/admin/icons';
import styles from './users.module.css';

type Props = { id: string; role: UserRole; active: boolean; isSelf: boolean; hasMfa: boolean };

export function UserRowActions({ id, role, active, isSelf, hasMfa }: Props) {
  const t = useTranslations('users');
  const { confirm, alert } = useDialogs();
  const [pending, startTransition] = useTransition();

  function errorText(result: Extract<UserActionResult, { ok: false }>) {
    const key = `errors.${result.error}`;
    return t.has(key) ? t(key) : t('errors.generic');
  }

  async function onToggle() {
    if (active && !(await confirm(t('deactivate-confirm'), { tone: 'danger' }))) return;
    startTransition(async () => {
      const result = await setActive(id, !active);
      if (!result.ok) alert(errorText(result));
    });
  }

  function onResend() {
    startTransition(async () => {
      const result = await resendInvite(id);
      if (!result.ok) return alert(errorText(result));
      alert(t(result.sent === 'password' ? 'password-link-sent' : 'invite-resent'), {
        tone: 'success',
      });
    });
  }

  async function onResetMfa() {
    if (!(await confirm(t('mfa-reset-confirm'), { tone: 'danger' }))) return;
    startTransition(async () => {
      const result = await resetMfa(id);
      if (!result.ok) return alert(errorText(result));
      alert(t('mfa-reset-done'), { tone: 'success' });
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
        <Icon name={active ? 'deactivate' : 'reactivate'} size={15} />
        {active ? t('deactivate') : t('reactivate')}
      </button>
      {role !== UserRole.Guide && active && (
        <button type="button" className={styles.resendBtn} onClick={onResend} disabled={pending}>
          <Icon name="resend" size={15} />
          {t('resend-invite')}
        </button>
      )}
      {hasMfa && active && !isSelf && (
        <button
          type="button"
          className={styles.deactivateBtn}
          onClick={onResetMfa}
          disabled={pending}
        >
          <Icon name="deactivate" size={15} />
          {t('mfa-reset')}
        </button>
      )}
    </div>
  );
}
