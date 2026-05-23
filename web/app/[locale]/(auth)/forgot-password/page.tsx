import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requestPasswordReset } from './actions';
import styles from './page.module.css';

type Props = {
  searchParams: Promise<{ sent?: string; error?: string }>;
};

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const t = await getTranslations('auth');
  const { sent, error } = await searchParams;

  return (
    <>
      <h1 className={styles.title}>{t('forgot-password-title')}</h1>

      {error === 'link-expired' && <p className={styles.error}>{t('link-expired')}</p>}

      {sent ? (
        <p className={styles.success}>{t('check-email')}</p>
      ) : (
        <>
          <p className={styles.description}>{t('forgot-password-description')}</p>

          <form action={requestPasswordReset} className={styles.form}>
            <label className={styles.label}>
              {t('email')}
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                className={styles.input}
              />
            </label>

            <button type="submit" className={styles.submit}>
              {t('send-instructions')}
            </button>
          </form>
        </>
      )}

      <Link href="/login" className={styles.backLink}>
        {t('back-to-login')}
      </Link>
    </>
  );
}
