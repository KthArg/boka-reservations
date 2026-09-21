import { Link } from '@/i18n/navigation';
import styles from './booking.module.css';

type Props = {
  title: string;
  message: string;
  /** Enlace para volver a la reserva; se omite cuando el token no es válido. */
  backHref?: string;
  backLabel?: string;
};

/** Aviso de las páginas de la reserva cuando no hay nada que mostrar en su estado. */
export function BookingNotice({ title, message, backHref, backLabel }: Props) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.muted}>{message}</p>
        {backHref ? (
          <Link href={backHref} className={styles.link}>
            {backLabel}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
