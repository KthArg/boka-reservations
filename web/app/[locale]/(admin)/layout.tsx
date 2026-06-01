import { getCurrentUser } from '@/lib/auth/server';
import { signOut } from '@/lib/auth/actions';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import styles from './admin.module.css';

type Props = { children: React.ReactNode };

export default async function AdminLayout({ children }: Props) {
  const [tAuth, tTours, tBookings, tGuides] = await Promise.all([
    getTranslations('auth'),
    getTranslations('tours'),
    getTranslations('bookings'),
    getTranslations('guides'),
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
          <Link href="/dashboard/salidas" className={styles.navLink}>
            {tGuides('nav-label')}
          </Link>
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
