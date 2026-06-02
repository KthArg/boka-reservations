'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createUser, updateUser } from '@/lib/users/actions';
import { UserRole } from '@shared/constants/enums';
import type { FormResult, UserListItem } from '@/lib/users/types';
import styles from './UserForm.module.css';

type Props = { user?: UserListItem };

export default function UserForm({ user }: Props) {
  const t = useTranslations('users');
  const isEdit = !!user;
  const action = isEdit ? updateUser.bind(null, user.id) : createUser;
  const [state, formAction, pending] = useActionState<FormResult | null, FormData>(action, null);
  const errors = state && !state.success ? state.errors : {};
  const [role, setRole] = useState<UserRole>((user?.role as UserRole) ?? UserRole.Guide);

  const tr = (code: string) =>
    t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
  const fieldError = (key: string) => {
    const code = errors[key]?.[0];
    return code ? <span className={styles.fieldError}>{tr(code)}</span> : null;
  };

  return (
    <form action={formAction} className={styles.form}>
      {errors._form?.map((code) => (
        <p key={code} className={styles.formError}>
          {tr(code)}
        </p>
      ))}

      <label className={styles.label}>
        {t('field-full-name')}
        <input
          name="full_name"
          required
          maxLength={120}
          defaultValue={user?.full_name ?? ''}
          className={styles.input}
        />
        {fieldError('full_name')}
      </label>

      <label className={styles.label}>
        {t('field-email')}
        <input
          type="email"
          name="email"
          required
          defaultValue={user?.email ?? ''}
          disabled={isEdit}
          className={styles.input}
        />
        {fieldError('email')}
      </label>

      <label className={styles.label}>
        {t('field-role')}
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          disabled={isEdit}
          className={styles.input}
        >
          <option value={UserRole.Guide}>{t('role-guide')}</option>
          <option value={UserRole.Staff}>{t('role-staff')}</option>
          <option value={UserRole.Admin}>{t('role-admin')}</option>
        </select>
      </label>

      <label className={styles.label}>
        {t('field-phone')}
        {role === UserRole.Guide ? ' *' : ''}
        <input name="phone" defaultValue={user?.phone ?? ''} className={styles.input} />
        {fieldError('phone')}
      </label>

      <label className={styles.label}>
        {t('field-locale')}
        <select name="locale" defaultValue={user?.locale ?? 'es'} className={styles.input}>
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </label>

      {!isEdit && <p className={styles.hint}>{t('invite-hint')}</p>}

      <button type="submit" disabled={pending} className={styles.submitBtn}>
        {pending ? '…' : isEdit ? t('submit-update') : t('submit-create')}
      </button>
    </form>
  );
}
