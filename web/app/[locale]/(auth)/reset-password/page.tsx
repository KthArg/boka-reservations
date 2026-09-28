import { getTranslations } from 'next-intl/server';
import { MIN_PASSWORD_LENGTH, PASSWORD_PATTERN } from '@/lib/auth/password-policy';
import { updatePassword } from './actions';
import styles from './page.module.css';

// Cada error del formulario con su texto; cualquier otro valor se trata como enlace vencido.
const ERROR_MESSAGES: Record<string, string> = {
  'invalid-password': 'password-invalid',
  'update-failed': 'password-update-failed',
};

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: Props) {
  const t = await getTranslations('auth');
  const { error } = await searchParams;

  return (
    <>
      <h1 className={styles.title}>{t('reset-password-title')}</h1>

      {error && <p className={styles.error}>{t(ERROR_MESSAGES[error] ?? 'link-expired')}</p>}

      <form action={updatePassword} className={styles.form}>
        <label className={styles.label}>
          {t('new-password-label')}
          <input
            type="password"
            name="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            pattern={PASSWORD_PATTERN}
            title={t('password-requirements')}
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
