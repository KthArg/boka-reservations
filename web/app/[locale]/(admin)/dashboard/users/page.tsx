import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { getCurrentUser, requireRole } from '@/lib/auth/server';
import { listUsers } from '@/lib/users/repository';
import { UserRole } from '@shared/constants/enums';
import { UserFilters } from './UserFilters';
import { UserRowActions } from './UserRowActions';
import { Icon } from '@/components/admin/icons';
import styles from './users.module.css';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ role?: string; active?: string }>;
};

function parseFilters(sp: { role?: string; active?: string }) {
  const role =
    sp.role && (Object.values(UserRole) as string[]).includes(sp.role)
      ? (sp.role as UserRole)
      : undefined;
  const active = sp.active === 'true' ? true : sp.active === 'false' ? false : undefined;
  return { role, active };
}

export default async function UsersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  try {
    await requireRole(UserRole.Admin);
  } catch {
    redirect(`/${locale}/dashboard`);
  }

  const [t, sp] = await Promise.all([getTranslations('users'), searchParams]);
  const filters = parseFilters(sp);
  const [users, current] = await Promise.all([listUsers(filters), getCurrentUser()]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('page-title')}</h1>
        <Link href="/dashboard/users/new" className={styles.newBtn}>
          {t('new-user')}
        </Link>
      </div>

      <UserFilters role={filters.role} active={filters.active} />

      {users.length === 0 ? (
        <p className={styles.empty}>{t('no-users')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>{t('col-name')}</th>
              <th className={styles.th}>{t('col-email')}</th>
              <th className={styles.th}>{t('col-role')}</th>
              <th className={styles.th}>{t('col-status')}</th>
              <th className={styles.th}>{t('col-actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={styles.row}>
                <td className={styles.td}>{u.full_name}</td>
                <td className={styles.td}>{u.email}</td>
                <td className={styles.td}>
                  <span className={styles.badgeRole}>{t(`role-${u.role}`)}</span>
                </td>
                <td className={styles.td}>
                  <span className={u.active ? styles.badgeActive : styles.badgeInactive}>
                    {u.active ? t('status-active') : t('status-inactive')}
                  </span>
                </td>
                <td className={`${styles.td} ${styles.actions}`}>
                  <Link href={`/dashboard/users/${u.id}/edit`} className={styles.editBtn}>
                    <Icon name="edit" size={15} />
                    {t('edit')}
                  </Link>
                  <UserRowActions
                    id={u.id}
                    role={u.role as UserRole}
                    active={u.active}
                    isSelf={current?.id === u.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
