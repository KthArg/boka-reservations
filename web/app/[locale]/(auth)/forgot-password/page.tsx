import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ForgotPasswordForm from './ForgotPasswordForm';
import styles from './page.module.css';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
};

export default async function ForgotPasswordPage({ params, searchParams }: Props) {
  const { locale } = await params;
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
          <ForgotPasswordForm
            locale={locale}
            labels={{ email: t('email'), send: t('send-instructions') }}
          />
        </>
      )}

      <Link href="/login" className={styles.backLink}>
        {t('back-to-login')}
      </Link>
    </>
  );
}
