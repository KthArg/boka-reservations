'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleAlert, CircleCheck, CircleHelp, Info, TriangleAlert } from 'lucide-react';
import styles from './DialogProvider.module.css';

/**
 * Diálogos propios de la aplicación (spec 0042): reemplazan a window.confirm y window.alert con
 * la identidad de la marca. Usan <dialog> nativo, que ya resuelve el foco, Escape y el fondo.
 * La API imita a la del navegador pero devuelve promesas:
 *
 *   const { confirm, alert } = useDialogs();
 *   if (!(await confirm(t('pregunta'), { tone: 'danger' }))) return;
 *   alert(t('error'));
 */

export type ConfirmTone = 'default' | 'danger';
export type AlertTone = 'error' | 'success' | 'info';

type ConfirmOptions = { tone?: ConfirmTone; confirmLabel?: string };
type AlertOptions = { tone?: AlertTone };

type Request =
  | { kind: 'confirm'; message: string; tone: ConfirmTone; confirmLabel?: string }
  | { kind: 'alert'; message: string; tone: AlertTone };

type Dialogs = {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  alert: (message: string, options?: AlertOptions) => Promise<void>;
};

const DialogsContext = createContext<Dialogs | null>(null);

export function useDialogs(): Dialogs {
  const dialogs = useContext(DialogsContext);
  if (!dialogs) throw new Error('useDialogs necesita un <DialogProvider> más arriba');
  return dialogs;
}

const ICON = {
  default: CircleHelp,
  danger: TriangleAlert,
  error: CircleAlert,
  success: CircleCheck,
  info: Info,
} as const;

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const messageId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [request, setRequest] = useState<Request | null>(null);
  // Quien espera la respuesta del diálogo abierto. Uno a la vez, como los del navegador: si llega
  // otro pedido mientras hay uno abierto, el anterior se resuelve como "cancelar".
  const settle = useRef<((value: boolean) => void) | null>(null);

  const open = useCallback((next: Request) => {
    settle.current?.(false);
    return new Promise<boolean>((resolve) => {
      settle.current = resolve;
      setRequest(next);
    });
  }, []);

  const confirm = useCallback<Dialogs['confirm']>(
    (message, options) =>
      open({
        kind: 'confirm',
        message,
        tone: options?.tone ?? 'default',
        confirmLabel: options?.confirmLabel,
      }),
    [open],
  );

  const alert = useCallback<Dialogs['alert']>(
    async (message, options) => {
      await open({ kind: 'alert', message, tone: options?.tone ?? 'error' });
    },
    [open],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!request || !dialog || dialog.open) return;
    dialog.showModal();
    // El foco va al botón principal en un aviso y a "Cancelar" en una confirmación peligrosa.
    if (request.kind === 'confirm' && request.tone === 'danger') return;
    confirmRef.current?.focus();
  }, [request]);

  function close(value: boolean) {
    settle.current?.(value);
    settle.current = null;
    dialogRef.current?.close();
  }

  const Icon = request ? ICON[request.tone] : null;

  return (
    <DialogsContext.Provider value={{ confirm, alert }}>
      {children}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        data-tone={request?.tone}
        aria-describedby={messageId}
        // Escape o cerrar desde el navegador cuenta como cancelar.
        onClose={() => {
          // El evento llega después de close(); si ya se abrió otro pedido, no es de este.
          if (dialogRef.current?.open) return;
          settle.current?.(false);
          settle.current = null;
          setRequest(null);
        }}
        onClick={(event) => {
          // Clic en el fondo (fuera de la tarjeta) también cancela.
          if (event.target === event.currentTarget) close(false);
        }}
      >
        {request && Icon ? (
          <div className={styles.card}>
            <span className={styles.icon} aria-hidden="true">
              <Icon size={26} strokeWidth={1.8} />
            </span>
            <p id={messageId} className={styles.message}>
              {request.message}
            </p>
            <div className={styles.actions}>
              {request.kind === 'confirm' ? (
                <>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => close(false)}
                    autoFocus={request.tone === 'danger'}
                  >
                    {t('cancel')}
                  </button>
                  <button
                    ref={confirmRef}
                    type="button"
                    className={request.tone === 'danger' ? styles.danger : styles.primary}
                    onClick={() => close(true)}
                  >
                    {request.confirmLabel ?? t('confirm')}
                  </button>
                </>
              ) : (
                <button
                  ref={confirmRef}
                  type="button"
                  className={styles.primary}
                  onClick={() => close(true)}
                >
                  {t('ok')}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </dialog>
    </DialogsContext.Provider>
  );
}
