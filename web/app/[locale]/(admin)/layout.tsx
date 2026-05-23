import { getCurrentUser } from '@/lib/auth/server';
import { signOut } from '@/lib/auth/actions';
import { getTranslations } from 'next-intl/server';
import styles from './admin.module.css';

type Props = { children: React.ReactNode };

export default async function AdminLayout({ children }: Props) {
  const t = await getTranslations('auth');
  const user = await getCurrentUser();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>Boka Trails</div>

        <nav className={styles.nav}>
          <span className={styles.placeholder}>Panel en construcción</span>
        </nav>

        <div className={styles.footer}>
          {user && <p className={styles.userEmail}>{user.email}</p>}
          <form action={signOut}>
            <button type="submit" className={styles.logoutBtn}>
              {t('logout')}
            </button>
          </form>
        </div>
      </aside>

      <main className={styles.content}>{children}</main>
    </div>
  );
}
