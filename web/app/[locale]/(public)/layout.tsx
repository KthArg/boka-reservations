import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/public/LocaleSwitcher/LocaleSwitcher';
import { SiteFooter } from '@/components/public/SiteFooter/SiteFooter';
import styles from './layout.module.css';

type Props = { children: React.ReactNode };

export default async function PublicLayout({ children }: Props) {
  const t = await getTranslations('public');

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.logo}>
            Boka Verde
          </Link>
          <nav className={styles.nav}>
            <Link href="/tours" className={styles.navLink}>
              {t('nav-tours')}
            </Link>
          </nav>
          <LocaleSwitcher />
        </div>
      </header>

      <main className={styles.main}>{children}</main>

      <SiteFooter />
    </div>
  );
}
