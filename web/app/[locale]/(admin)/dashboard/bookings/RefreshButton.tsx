'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import styles from './bookings.module.css';

// Recarga los datos del servidor (Server Components de la ruta) conservando la URL y, con ella,
// los filtros que viven en query params (spec 0026, ítem 1). Sin recargar la app entera ni perder
// el scroll. No usa Realtime ni websockets (decisión del spec): refresco manual, liviano.
export function RefreshButton() {
  const t = useTranslations('bookings');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button type="button" className={styles.secondaryBtn} onClick={onClick} disabled={pending}>
      {pending ? t('refresh-pending') : t('refresh')}
    </button>
  );
}
