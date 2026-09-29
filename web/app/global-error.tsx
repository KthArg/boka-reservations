'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import styles from './global-error.module.css';

type Props = { error: Error & { digest?: string }; reset: () => void };

/**
 * Pantalla de error de último recurso (spec 0038): reemplaza al layout raíz, así que no tiene el
 * proveedor de idiomas y el texto va en los dos idiomas. Reporta el error a Sentry, que sin esto
 * no recibía los errores de render del navegador. Solo actúa en el build de producción.
 */
export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body className={styles.body}>
        <main className={styles.card}>
          <h1 className={styles.title}>Algo salió mal · Something went wrong</h1>
          <p className={styles.text}>
            Ya nos avisaron del error. Probá de nuevo en un momento.
            <br />
            We have been notified. Please try again in a moment.
          </p>
          <button type="button" className={styles.button} onClick={reset}>
            Reintentar · Try again
          </button>
        </main>
      </body>
    </html>
  );
}
