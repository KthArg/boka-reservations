import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requirePanelSessionForMfa } from '@/lib/auth/server';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { AAL2 } from '@/lib/auth/session-claims';
import { mfaDestination } from '@/lib/auth/mfa-destination';
import { FACTOR_VERIFIED } from '@/lib/auth/mfa-types';
import { signOut } from '@/lib/auth/actions';
import { MfaForm } from './MfaForm';
import styles from './page.module.css';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ redirectTo?: string }>;
};

// Segundo factor del panel (spec 0049 §5.1): enrolamiento la primera vez, desafío después.
export default async function MfaPage({ params, searchParams }: Props) {
  const [{ locale }, { redirectTo }] = await Promise.all([params, searchParams]);
  const target = mfaDestination(redirectTo, locale);

  const user = await requirePanelSessionForMfa().catch(() => null);
  if (!user) redirect(`/${locale}/login`);
  if (user.aal === AAL2) redirect(target);

  const supabase = await createSupabaseServerClient();
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  // Si falla, se ofrece el enrolamiento: la acción vuelve a leer los factores y responde ahí.
  if (error) console.error('[mfa] listFactors:', error.code);
  const verified = factors?.totp.find((f) => f.status === FACTOR_VERIFIED);
  const t = await getTranslations('auth');

  return (
    <>
      <h1 className={styles.title}>
        {verified ? t('mfa-challenge-title') : t('mfa-enroll-title')}
      </h1>
      <p className={styles.description}>
        {verified ? t('mfa-challenge-description') : t('mfa-enroll-description')}
      </p>
      <MfaForm
        mode={verified ? 'challenge' : 'enroll'}
        factorId={verified?.id}
        redirectTo={target}
      />
      <form action={signOut}>
        <button type="submit" className={styles.signOut}>
          {t('logout')}
        </button>
      </form>
    </>
  );
}
