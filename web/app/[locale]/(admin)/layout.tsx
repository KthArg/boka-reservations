import { getCurrentUser, requireAnyRole } from '@/lib/auth/server';
import { signOut } from '@/lib/auth/actions';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { UserRole } from '@shared/constants/enums';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import { AdminSidebar } from './AdminSidebar';
import styles from './admin.module.css';

type Props = { children: React.ReactNode };

export default async function AdminLayout({ children }: Props) {
  // Guard de rol: único choke-point de autorización del panel (F-2, spec 0019).
  // Solo admin/staff entran; las páginas admin-only (users) suman su requireRole(Admin).
  const authorized = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!authorized) {
    const locale = await getLocale();
    redirect(`/${locale}/login`);
  }

  const [tAuth, tTours, tBookings, tGuides, tUsers, tReports, tCommon] = await Promise.all([
    getTranslations('auth'),
    getTranslations('tours'),
    getTranslations('bookings'),
    getTranslations('guides'),
    getTranslations('users'),
    getTranslations('reports'),
    getTranslations('common'),
  ]);
  const user = await getCurrentUser();

  // primary = se muestran como íconos en la barra móvil; el resto va al menú hamburguesa.
  const items = [
    { href: '/dashboard/tours', label: tTours('nav-label'), icon: 'tours', primary: true },
    { href: '/dashboard/bookings', label: tBookings('nav-label'), icon: 'bookings', primary: true },
    {
      href: '/dashboard/departures',
      label: tGuides('nav-label'),
      icon: 'departures',
      primary: true,
    },
    { href: '/dashboard/reports', label: tReports('nav-label'), icon: 'reports', primary: false },
  ];
  if (user?.role === UserRole.Admin) {
    items.push({
      href: '/dashboard/users',
      label: tUsers('nav-label'),
      icon: 'users',
      primary: false,
    });
  }

  return (
    <div className={styles.shell}>
      <AdminSidebar
        items={items}
        userEmail={user?.email}
        logoutLabel={tAuth('logout')}
        toggleLabel={tCommon('toggle-sidebar')}
        menuLabel={tCommon('menu')}
        signOut={signOut}
      />
      <main className={styles.content}>{children}</main>
    </div>
  );
}
