import { getCurrentUser, requireAnyRole } from '@/lib/auth/server';
import { signOut } from '@/lib/auth/actions';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { UserRole } from '@shared/constants/enums';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import styles from './admin.module.css';

type Props = { children: React.ReactNode };

export default async function AdminLayout({ children }: Props) {
  // Guard de rol en un único choke-point para TODO el panel (F-2, spec 0019). El middleware
  // ya exige autenticación, pero la autorización por rol no estaba a nivel de página en
  // bookings/departures/tours (dependían solo de RLS). Esta barrera la hace explícita: solo
  // admin/staff entran al shell del panel; las páginas admin-only (users) suman su propio
  // requireRole(Admin). Defensa en profundidad ante un repo que en el futuro use service_role.
  const authorized = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!authorized) {
    const locale = await getLocale();
    redirect(`/${locale}/login`);
  }

  const [tAuth, tTours, tBookings, tGuides, tUsers, tReports] = await Promise.all([
    getTranslations('auth'),
    getTranslations('tours'),
    getTranslations('bookings'),
    getTranslations('guides'),
    getTranslations('users'),
    getTranslations('reports'),
  ]);
  const user = await getCurrentUser();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>Boka Trails</div>

        <nav className={styles.nav}>
          <Link href="/dashboard/tours" className={styles.navLink}>
            {tTours('nav-label')}
          </Link>
          <Link href="/dashboard/bookings" className={styles.navLink}>
            {tBookings('nav-label')}
          </Link>
          <Link href="/dashboard/departures" className={styles.navLink}>
            {tGuides('nav-label')}
          </Link>
          <Link href="/dashboard/reports" className={styles.navLink}>
            {tReports('nav-label')}
          </Link>
          {user?.role === UserRole.Admin && (
            <Link href="/dashboard/users" className={styles.navLink}>
              {tUsers('nav-label')}
            </Link>
          )}
        </nav>

        <div className={styles.footer}>
          {user && <p className={styles.userEmail}>{user.email}</p>}
          <form action={signOut}>
            <button type="submit" className={styles.logoutBtn}>
              {tAuth('logout')}
            </button>
          </form>
        </div>
      </aside>

      <main className={styles.content}>{children}</main>
    </div>
  );
}
