'use client';

import styles from './LegalPage.module.css';

/** Imprimir o guardar en PDF desde el navegador: la hoja de impresión oculta el resto del sitio. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className={styles.print} onClick={() => window.print()}>
      {label}
    </button>
  );
}
