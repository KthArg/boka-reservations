import type { OnvopayChargeClient } from './onvopay.js';
import { alertCharge, MSG_CANCEL_INTENT_FAILED } from './alerts.js';

/**
 * Cancela en OnvoPay el intent de una reserva que ya quedó cancelada en DB. Best-effort: el pago
 * ya está `failed` sin cierre y close-payment-intents lo reintenta, así que un fallo no aborta;
 * pero se alerta, para que un fallo persistente no quede solo en los logs.
 */
export async function cancelIntentBestEffort(
  client: OnvopayChargeClient,
  bookingId: string,
  externalPaymentId: string,
  source: string,
): Promise<void> {
  try {
    await client.cancelIntent(externalPaymentId);
  } catch (err) {
    console.error(
      `[${source}] cancel del intent falló; lo reintenta close-payment-intents`,
      bookingId,
      err instanceof Error ? err.message : err,
    );
    alertCharge(MSG_CANCEL_INTENT_FAILED, `${source}-cancel-intent-failed`, bookingId);
  }
}
