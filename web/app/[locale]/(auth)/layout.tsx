import { BrandLogo } from '@/components/brand/BrandLogo';
import styles from './auth.module.css';

type Props = { children: React.ReactNode };

/** Pantalla dividida (spec 0042): panel de marca en verde noche y el formulario sobre hueso. */
export default function AuthLayout({ children }: Props) {
  return (
    <div className={styles.wrapper}>
      <div className={`theme-night ${styles.brandPanel}`}>
        <span className={styles.sun} aria-hidden="true" />
        <span className={styles.moon} aria-hidden="true" />
        <BrandLogo variant="bone" className={`bv-fade ${styles.logo}`} priority />
      </div>
      <div className={styles.formSide}>
        <main className={`bv-rise ${styles.card}`}>{children}</main>
      </div>
    </div>
  );
}
