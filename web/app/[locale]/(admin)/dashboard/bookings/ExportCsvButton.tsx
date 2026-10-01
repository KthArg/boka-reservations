'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { validateExportRange } from '@/lib/booking/admin-filters';
import styles from './bookings.module.css';

/**
 * Exporta con lo que está escrito en el formulario de filtros, sin tener que tocar "Filtrar"
 * antes: el botón envía el mismo GET al route del export (`formAction`), y la respuesta es un
 * adjunto, así que la página no navega. Se habilita apenas el rango escrito es válido; el route
 * vuelve a validar.
 */
export function ExportCsvButton() {
  const t = useTranslations('bookings');
  const locale = useLocale();
  const ref = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const check = () => {
      const data = new FormData(form);
      const dateFrom = String(data.get('dateFrom') ?? '') || undefined;
      const dateTo = String(data.get('dateTo') ?? '') || undefined;
      setReady(validateExportRange({ dateFrom, dateTo, page: 1 }) === null);
    };
    check();
    form.addEventListener('input', check);
    form.addEventListener('change', check);
    return () => {
      form.removeEventListener('input', check);
      form.removeEventListener('change', check);
    };
  }, []);

  return (
    <button
      ref={ref}
      type="submit"
      formAction={`/${locale}/dashboard/bookings/export`}
      aria-disabled={!ready}
      title={ready ? undefined : t('export-hint')}
      onClick={(e) => {
        if (!ready) e.preventDefault();
      }}
      className={ready ? styles.secondaryBtn : styles.exportDisabled}
    >
      {t('export-csv')}
    </button>
  );
}
