import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { signIn } from './actions';
import styles from './page.module.css';

type Props = {
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const t = await getTranslations('auth');
  const { error, redirectTo } = await searchParams;

  return (
    <>
      <h1 className={styles.title}>{t('login')}</h1>

      {error === 'invalid-credentials' && (
        <p className={styles.error}>{t('error-invalid-credentials')}</p>
      )}

      <form action={signIn} className={styles.form}>
        {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}

        <label className={styles.label}>
          {t('email')}
          <input type="email" name="email" required autoComplete="email" className={styles.input} />
        </label>

        <label className={styles.label}>
          {t('password')}
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className={styles.input}
          />
        </label>

        <button type="submit" className={styles.submit}>
          {t('submit-login')}
        </button>
      </form>

      <Link href="/forgot-password" className={styles.forgotLink}>
        {t('forgot-password-link')}
      </Link>
    </>
  );
}
