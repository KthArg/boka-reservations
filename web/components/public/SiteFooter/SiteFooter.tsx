import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getOperatorIdentity } from '@/lib/operator/repository';
import { isOperatorIdentityComplete } from '@/lib/operator/types';
import { BrandLogo } from '@/components/brand/BrandLogo';
import styles from './SiteFooter.module.css';

/**
 * Pie del sitio con la identidad del operador y los enlaces legales (spec 0034, textos aprobados
 * §3.4). Lo usan el portal público y las páginas de la reserva: la cláusula 1 de los términos
 * identifica al vendedor en todo el sitio, no solo en el checkout.
 */
export async function SiteFooter() {
  const [t, operator] = await Promise.all([getTranslations('footer'), getOperatorIdentity()]);
  const complete = isOperatorIdentityComplete(operator);

  return (
    // Spec 0042: pie en verde noche con el logo mixto, como el cierre de la landing.
    <footer className={`theme-night ${styles.footer}`}>
      <div className={styles.inner}>
        {complete ? (
          <p className={styles.identity}>
            {[
              operator.legalName,
              t('tax-id', { taxId: operator.taxId }),
              operator.address,
              operator.contactEmail,
              operator.phone,
            ].join(' · ')}
          </p>
        ) : null}
        <nav className={styles.links} aria-label={t('legal-nav')}>
          <Link href="/terms">{t('terms')}</Link>
          <Link href="/privacy">{t('privacy')}</Link>
          <Link href={{ pathname: '/terms', hash: 'quejas' }}>{t('complaints')}</Link>
        </nav>
        <BrandLogo variant="mix" className={styles.logo} decorative />
      </div>
    </footer>
  );
}
