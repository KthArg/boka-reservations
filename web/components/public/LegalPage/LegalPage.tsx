import { Link } from '@/i18n/navigation';
import styles from './LegalPage.module.css';

type Props = {
  title: string;
  body: string;
  backLabel: string;
};

/**
 * Página legal genérica (spec 0021, P1-3): renderiza un aviso (privacidad / términos) con su
 * título y cuerpo. El contenido viene de los diccionarios i18n; el texto definitivo lo redacta
 * el cliente (operador). Compartida por /privacy y /terms para no duplicar layout.
 */
export function LegalPage({ title, body, backLabel }: Props) {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.body}>{body}</p>
      <Link href="/" className={styles.back}>
        {backLabel}
      </Link>
    </div>
  );
}
