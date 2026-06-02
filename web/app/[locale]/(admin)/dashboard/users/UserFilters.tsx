'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { UserRole } from '@shared/constants/enums';
import styles from './users.module.css';

type Props = { role?: UserRole; active?: boolean };

export function UserFilters({ role, active }: Props) {
  const t = useTranslations('users');
  const router = useRouter();
  const pathname = usePathname();

  function update(key: 'role' | 'active', value: string) {
    const current = { role: role ?? '', active: active === undefined ? '' : String(active) };
    current[key] = value;
    const params = new URLSearchParams();
    if (current.role) params.set('role', current.role);
    if (current.active) params.set('active', current.active);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className={styles.filters}>
      <label className={styles.filterLabel}>
        {t('filter-role')}
        <select
          className={styles.filterSelect}
          value={role ?? ''}
          onChange={(e) => update('role', e.target.value)}
        >
          <option value="">{t('filter-all')}</option>
          <option value={UserRole.Admin}>{t('role-admin')}</option>
          <option value={UserRole.Staff}>{t('role-staff')}</option>
          <option value={UserRole.Guide}>{t('role-guide')}</option>
        </select>
      </label>
      <label className={styles.filterLabel}>
        {t('filter-status')}
        <select
          className={styles.filterSelect}
          value={active === undefined ? '' : String(active)}
          onChange={(e) => update('active', e.target.value)}
        >
          <option value="">{t('filter-all')}</option>
          <option value="true">{t('status-active')}</option>
          <option value="false">{t('status-inactive')}</option>
        </select>
      </label>
    </div>
  );
}
