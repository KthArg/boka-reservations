'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser';
import { useRouter } from '@/i18n/navigation';
import styles from './page.module.css';

type Props = {
  locale: string;
  labels: {
    email: string;
    send: string;
  };
};

export default function ForgotPasswordForm({ locale, labels }: Props) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value;
    const supabase = createSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/${locale}/auth/callback`;
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    router.push('/forgot-password?sent=true');
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <label className={styles.label}>
        {labels.email}
        <input type="email" name="email" required autoComplete="email" className={styles.input} />
      </label>
      <button type="submit" className={styles.submit} disabled={pending}>
        {labels.send}
      </button>
    </form>
  );
}
