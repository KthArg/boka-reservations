import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BrandLogo } from '@/components/brand/BrandLogo';
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
          <Link href="/" className={styles.logo} aria-label="Boka Verde">
            {/* Spec 0042: logo verde sobre hueso; en la página de un tour de noche, hueso. */}
            <BrandLogo variant="forest" className={styles.logoDay} priority />
            <BrandLogo variant="bone" className={styles.logoNight} decorative />
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
