import 'server-only';
import type { PaymentProvider } from '../../types';
import { createOnvopayHttp, ONVOPAY_API_BASE_DEFAULT } from './http';
import { intentOperations } from './intents';
import { customerOperations } from './customers';
import { createWebhookVerifier } from './webhook';

/**
 * Adapter de OnvoPay (única implementación de PaymentProvider en el MVP). Compone las
 * operaciones por recurso: intents, customers y métodos de pago, y verificación de webhooks.
 */
export function createOnvopayAdapter(
  secretKey: string,
  webhookSecret: string,
  baseUrl: string = ONVOPAY_API_BASE_DEFAULT,
): PaymentProvider {
  const http = createOnvopayHttp(secretKey, baseUrl);
  return {
    ...intentOperations(http),
    ...customerOperations(http),
    verifyWebhook: createWebhookVerifier(webhookSecret),
  };
}
