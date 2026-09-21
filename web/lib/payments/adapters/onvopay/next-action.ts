import * as Sentry from '@sentry/nextjs';
import { ONVO_JS_URL } from '@shared/constants/payments';

// 3DS con la librería web de OnvoPay (spec 0029 §5.7; docs "3DS Authentication", modal). Se carga
// con un <script> creado desde el bundle, igual que el widget: bajo 'strict-dynamic' la CSP confía
// en lo que carga un script con nonce, sin un <script src> estático. Los componentes lo usan a
// través de lib/payments/card-vault.ts.

type NextActionResult = { error?: unknown; paymentIntent?: { status?: string } };
type OnvoJs = { handleNextAction(params: { paymentIntentId: string }): Promise<NextActionResult> };
type OnvoFactory = (publicKey: string) => OnvoJs;

declare global {
  interface Window {
    ONVO?: OnvoFactory;
  }
}

/** `status` es lo que informa la librería; el estado final lo decide siempre el servidor. */
export type NextActionOutcome = { ok: true; status: string } | { ok: false };

const LOAD_TIMEOUT_MS = 20_000;
const FAILED: NextActionOutcome = { ok: false };

/** Un 3DS roto en producción tiene que dejar rastro: solo el motivo, sin datos del turista. */
function reportFailure(reason: string): void {
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setFingerprint(['onvo-3ds-failed', reason]);
    Sentry.captureMessage(`[3ds] ${reason}`);
  });
}

function loadLibrary(): Promise<OnvoFactory> {
  if (window.ONVO) return Promise.resolve(window.ONVO);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('onvo_js_timeout')), LOAD_TIMEOUT_MS);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${ONVO_JS_URL}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => {
      window.clearTimeout(timer);
      if (window.ONVO) resolve(window.ONVO);
      else reject(new Error('onvo_js_missing'));
    });
    script.addEventListener('error', () => {
      window.clearTimeout(timer);
      // Sin quitarlo, un reintento reusaría el elemento fallido y esperaría el timeout completo.
      script.remove();
      reject(new Error('onvo_js_load_failed'));
    });
    if (!existing) {
      script.src = ONVO_JS_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export async function handleOnvopayNextAction(paymentIntentId: string): Promise<NextActionOutcome> {
  const publicKey = process.env.NEXT_PUBLIC_ONVOPAY_PUBLIC_KEY;
  if (!publicKey) {
    reportFailure('missing_public_key');
    return FAILED;
  }
  try {
    const onvo = (await loadLibrary())(publicKey);
    const result = await onvo.handleNextAction({ paymentIntentId });
    // La documentación advierte que aun con la autenticación completa el cobro puede rechazarse:
    // esto solo informa al turista; lo asientan el webhook o watch-charges.
    if (result.error || !result.paymentIntent?.status) {
      reportFailure('next_action_error');
      return FAILED;
    }
    return { ok: true, status: result.paymentIntent.status };
  } catch (err) {
    reportFailure(err instanceof Error ? err.message : 'unknown');
    return FAILED;
  }
}
