import { z } from 'zod';
import type { CustomerParams, PaymentMethodDetails } from '../../types';
import { ensureOk, HTTP_NOT_FOUND, pathId, readJson, type OnvopayHttp } from './http';

// La respuesta decide si la tarjeta es del customer y termina en la DB: se valida su forma.
const PaymentMethodBodySchema = z.object({
  id: z.string().min(1),
  status: z.string().nullish(),
  customerId: z.string().nullish(),
  card: z
    .object({
      brand: z.string().nullish(),
      last4: z.string().nullish(),
      expMonth: z.number().int().nullish(),
      expYear: z.number().int().nullish(),
    })
    .nullish(),
});

const CustomerBodySchema = z.object({ id: z.string().min(1) });

// Customers y métodos de pago (spec 0029 §5.2). Verificado en sandbox: el GET del método
// devuelve marca, últimos 4, vencimiento y customerId; detach lo deja `detached` y el DELETE
// del customer devuelve 200.
export function customerOperations(http: OnvopayHttp) {
  return {
    async createCustomer(params: CustomerParams): Promise<{ customerId: string }> {
      const res = await http('POST', '/customers', { name: params.name, email: params.email });
      const parsed = CustomerBodySchema.safeParse(await readJson<unknown>(res, 'createCustomer'));
      if (!parsed.success) throw new Error('OnvoPay createCustomer: respuesta sin id');
      return { customerId: parsed.data.id };
    },

    /** Datos de la tarjeta obtenidos por el servidor: nunca se confía en los del navegador. */
    async getPaymentMethod(paymentMethodId: string): Promise<PaymentMethodDetails> {
      const res = await http('GET', `/payment-methods/${pathId(paymentMethodId)}`);
      const parsed = PaymentMethodBodySchema.safeParse(
        await readJson<unknown>(res, 'getPaymentMethod'),
      );
      if (!parsed.success) throw new Error('OnvoPay getPaymentMethod: respuesta inesperada');
      const body = parsed.data;
      return {
        id: body.id,
        status: body.status ?? null,
        customerId: body.customerId ?? null,
        brand: body.card?.brand ?? null,
        last4: body.card?.last4 ?? null,
        expMonth: body.card?.expMonth ?? null,
        expYear: body.card?.expYear ?? null,
      };
    },

    async detachPaymentMethod(paymentMethodId: string): Promise<void> {
      const res = await http('POST', `/payment-methods/${pathId(paymentMethodId)}/detach`);
      ensureOk(res, 'detachPaymentMethod');
    },

    /** Idempotente: un customer ya borrado (404) cuenta como borrado. */
    async deleteCustomer(customerId: string): Promise<void> {
      const res = await http('DELETE', `/customers/${pathId(customerId)}`);
      if (res.status === HTTP_NOT_FOUND) return;
      ensureOk(res, 'deleteCustomer');
    },
  };
}
