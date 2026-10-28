'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { CaptchaActionValue } from '@shared/constants/captcha';
import styles from './CheckoutForm.module.css';

// Tipado mínimo de Turnstile: solo la superficie que usa este componente.
// Doc: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
type TurnstileOptions = {
  sitekey: string;
  action: CaptchaActionValue;
  language: string;
  appearance: 'interaction-only';
  callback: () => void;
  'expired-callback': () => void;
  'error-callback': () => void;
};

type Turnstile = {
  render(container: HTMLElement, options: TurnstileOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type Props = {
  siteKey: string;
  action: CaptchaActionValue;
  /** Cambia con cada respuesta de la action: el token es de un solo uso y se pide otro. */
  resetKey: unknown;
  /** `true` mientras no hay token: el form no se envía, porque el servidor lo rechazaría. */
  onPendingChange: (pending: boolean) => void;
};

/**
 * Captcha de Cloudflare Turnstile del paso 1 (spec 0048, Fase B). Se monta recién cuando el
 * turista marca la casilla del aviso de privacidad, que declara los datos que van a Cloudflare.
 * Modo Managed, visible solo si Cloudflare pide interacción. Turnstile deja el token en el input
 * oculto `cf-turnstile-response` dentro del contenedor, y así viaja con el form.
 */
export function TurnstileWidget({ siteKey, action, resetKey, onPendingChange }: Props) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const lastResetKey = useRef(resetKey);
  // Script bloqueado (bloqueador de contenido, red) o desafío fallido: se avisa antes de enviar.
  const [failed, setFailed] = useState(false);
  const pendingChange = useRef(onPendingChange);
  useEffect(() => {
    pendingChange.current = onPendingChange;
  });

  useEffect(() => {
    const render = () => {
      if (!window.turnstile || !container.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        language: locale,
        appearance: 'interaction-only',
        callback: () => {
          setFailed(false);
          pendingChange.current(false);
        },
        'expired-callback': () => pendingChange.current(true),
        'error-callback': () => {
          setFailed(true);
          pendingChange.current(true);
        },
      });
    };
    const onScriptError = () => setFailed(true);

    pendingChange.current(true);
    // El <script> se agrega una sola vez (dedupe por src) y expone el global window.turnstile,
    // así que no se remueve al desmontar; el widget sí.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', render);
    script.addEventListener('error', onScriptError);
    if (!existing) {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
    render();

    return () => {
      script.removeEventListener('load', render);
      script.removeEventListener('error', onScriptError);
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
      pendingChange.current(false);
    };
  }, [siteKey, action, locale]);

  // Solo cuando llega otra respuesta: al montarse, el widget recién renderizado ya pide su token.
  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    if (widgetId.current && window.turnstile) {
      pendingChange.current(true);
      window.turnstile.reset(widgetId.current);
    }
  }, [resetKey]);

  return (
    <>
      <div ref={container} />
      {failed && (
        <p className={styles.error} role="alert">
          {t('captcha-failed')}
        </p>
      )}
    </>
  );
}
