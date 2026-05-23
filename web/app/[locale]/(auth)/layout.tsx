import styles from './auth.module.css';

type Props = { children: React.ReactNode };

export default function AuthLayout({ children }: Props) {
  return (
    <div className={styles.wrapper}>
      <main className={styles.card}>{children}</main>
    </div>
  );
}
