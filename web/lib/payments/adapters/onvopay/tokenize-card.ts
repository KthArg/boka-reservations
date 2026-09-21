import { ONVOPAY_API_BASE_URL_DEFAULT } from '@shared/constants/payments';
import type { CardInput } from '../../card-input';

// Tokenización de la tarjeta DESDE EL NAVEGADOR (spec 0029 §5.2): POST /v1/payment-methods con
// la publishable key y el customer que el servidor creó para el hold. PAN, CVV y vencimiento
// viajan solo a OnvoPay; nuestro backend recibe únicamente el paymentMethodId. connect-src de la
// CSP ya permite api.onvopay.com, que es también el host de sandbox (el modo lo define la llave).
// Los componentes lo usan a través de lib/payments/card-vault.ts, no directo.

// Un OnvoPay colgado no deja al turista esperando hasta que venza el hold.
const TOKENIZE_TIMEOUT_MS = 20_000;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;
// Llave mal configurada o bloqueada: no es un problema de la tarjeta del turista.
const AUTH_ERROR_STATUSES = new Set([401, 403]);

/** `rejected`: OnvoPay no aceptó la tarjeta. `unavailable`: falla de nuestro lado o del proveedor. */
export type TokenizationFailure = 'rejected' | 'unavailable';

export class CardTokenizationError extends Error {
  constructor(public readonly failure: TokenizationFailure) {
    // Sin detalle de la respuesta: puede reflejar datos de la tarjeta.
    super(`card_tokenization_${failure}`);
  }
}

function failureFor(status: number): TokenizationFailure {
  const clientError = status >= HTTP_CLIENT_ERROR_MIN && status < HTTP_SERVER_ERROR_MIN;
  return clientError && !AUTH_ERROR_STATUSES.has(status) ? 'rejected' : 'unavailable';
}

export async function tokenizeOnvopayCard(card: CardInput, customerId: string): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_ONVOPAY_API_BASE_URL ?? ONVOPAY_API_BASE_URL_DEFAULT;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/payment-methods`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_ONVOPAY_PUBLIC_KEY}`,
      },
      body: JSON.stringify({
        type: 'card',
        card: {
          number: card.number,
          expMonth: card.expMonth,
          expYear: card.expYear,
          cvv: card.cvv,
          holderName: card.holderName,
        },
        billing: { name: card.holderName },
        customerId,
      }),
      signal: AbortSignal.timeout(TOKENIZE_TIMEOUT_MS),
    });
  } catch {
    // Red caída, timeout o CSP que bloquea el request.
    throw new CardTokenizationError('unavailable');
  }

  if (!res.ok) throw new CardTokenizationError(failureFor(res.status));
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (!body || typeof body.id !== 'string') throw new CardTokenizationError('unavailable');
  return body.id;
}
