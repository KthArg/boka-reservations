import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { LocaleSwitcher } from '@/components/public/LocaleSwitcher/LocaleSwitcher';
import styles from './SiteHeader.module.css';

/** Encabezado del sitio (spec 0042): lo comparten el portal y las páginas de la reserva. */
export async function SiteHeader() {
  const t = await getTranslations('public');

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.logo} aria-label="Boka Verde">
          {/* Logo verde sobre hueso; en la página de un tour de noche, hueso. */}
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
  );
}
