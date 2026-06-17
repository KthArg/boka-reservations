import styles from './auth.module.css';

type Props = { children: React.ReactNode };

export default function AuthLayout({ children }: Props) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.panel}>
        <p className={styles.brand}>Boka Verde</p>
        <main className={styles.card}>{children}</main>
      </div>
    </div>
  );
}
