'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import styles from './LocaleSwitcher.module.css';

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale(next: string) {
    router.replace(pathname, { locale: next });
  }

  return (
    <div className={styles.switcher}>
      <button
        className={locale === 'es' ? styles.active : styles.option}
        onClick={() => switchLocale('es')}
        disabled={locale === 'es'}
      >
        ES
      </button>
      <span className={styles.divider}>|</span>
      <button
        className={locale === 'en' ? styles.active : styles.option}
        onClick={() => switchLocale('en')}
        disabled={locale === 'en'}
      >
        EN
      </button>
    </div>
  );
}
