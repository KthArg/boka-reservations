import { getTranslations } from 'next-intl/server';
import { updatePassword } from './actions';
import styles from './page.module.css';

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: Props) {
  const t = await getTranslations('auth');
  const { error } = await searchParams;

  return (
    <>
      <h1 className={styles.title}>{t('reset-password-title')}</h1>

      {error && (
        <p className={styles.error}>
          {error === 'invalid-password' ? t('new-password-label') : t('link-expired')}
        </p>
      )}

      <form action={updatePassword} className={styles.form}>
        <label className={styles.label}>
          {t('new-password-label')}
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={styles.input}
          />
        </label>

        <button type="submit" className={styles.submit}>
          {t('save-password')}
        </button>
      </form>
    </>
  );
}
