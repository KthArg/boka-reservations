import { SiteFooter } from '@/components/public/SiteFooter/SiteFooter';
import { SiteHeader } from '@/components/public/SiteHeader/SiteHeader';
import styles from './layout.module.css';

type Props = { children: React.ReactNode };

/**
 * Las páginas de la reserva (enlace personal del correo) llevan el mismo encabezado y pie que el
 * portal (spec 0034: el pie identifica al operador; spec 0042: misma identidad). Cada página
 * trae su propio <main>.
 */
export default function BookingLayout({ children }: Props) {
  return (
    <div className={styles.wrapper}>
      <SiteHeader />
      <div className={styles.content}>{children}</div>
      <SiteFooter />
    </div>
  );
}
