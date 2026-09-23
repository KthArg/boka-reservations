// Caminos de fallo parcial de initCheckout (spec 0028, A1): el widget JAMÁS debe
// recibir un paymentIntentId que no esté persistido en `payments`. Mocks de DB,
// holds, pricing y provider; se prueba el orden y la limpieza ante fallos.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  paymentsInsertError: null as null | { message: string },
  holdUpdateError: null as null | { message: string },
  paymentsInsert: vi.fn(),
  holdUpdate: vi.fn(),
}));

const holdMocks = vi.hoisted(() => ({
  createHold: vi.fn().mockResolvedValue({ holdId: 'h1' }),
  releaseHold: vi.fn().mockResolvedValue(undefined),
}));

const providerMocks = vi.hoisted(() => ({
  createPaymentSession: vi.fn().mockResolvedValue({ externalPaymentId: 'pi_1' }),
  cancelPaymentSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db/supabase-service', () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return {
          insert: () => ({
            select: () => ({ single: async () => ({ data: { id: 'b1' }, error: null }) }),
          }),
        };
      }
      if (table === 'payments') {
        return {
          insert: async (row: unknown) => {
            state.paymentsInsert(row);
            return { error: state.paymentsInsertError };
          },
        };
      }
      // tour_holds
      return {
        update: (patch: unknown) => ({
          eq: () => ({
            eq: async () => {
              state.holdUpdate(patch);
              return { error: state.holdUpdateError };
            },
          }),
        }),
      };
    },
  }),
}));

vi.mock('@/lib/booking/availability', () => holdMocks);

vi.mock('@/lib/booking/checkout-pricing', () => ({
  resolveAuthoritativeCharge: vi.fn().mockResolvedValue({ tourName: 'T', totalAmountCents: 5000 }),
}));

vi.mock('@/lib/payments', () => ({ getPaymentProvider: () => providerMocks }));

import { initCheckout } from '@/lib/booking/create';

const params = {
  instanceId: 'i1',
  sessionToken: 's1',
  customerName: 'Ana',
  customerEmail: 'ana@example.com',
  quantities: { adult: 1, child: 0, student: 0 },
  locale: 'es' as const,
  legalAccepted: true,
};

describe('initCheckout — fallos parciales (spec 0028)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.paymentsInsertError = null;
    state.holdUpdateError = null;
    holdMocks.createHold.mockResolvedValue({ holdId: 'h1' });
    providerMocks.createPaymentSession.mockResolvedValue({ externalPaymentId: 'pi_1' });
    providerMocks.cancelPaymentSession.mockResolvedValue(undefined);
  });

  it('camino feliz: persiste el pago ANTES de pasar el hold a paying y devuelve el intent', async () => {
    const result = await initCheckout(params);

    expect(result).toEqual({ externalPaymentId: 'pi_1', bookingId: 'b1' });
    expect(state.paymentsInsert).toHaveBeenCalledTimes(1);
    expect(state.holdUpdate).toHaveBeenCalledWith({ status: 'paying' });
    expect(holdMocks.releaseHold).not.toHaveBeenCalled();
  });

  it('INSERT de payments falla: cancela el intent, libera el hold y NO devuelve el intent', async () => {
    state.paymentsInsertError = { message: 'insert failed' };

    await expect(initCheckout(params)).rejects.toThrow('insert failed');

    expect(providerMocks.cancelPaymentSession).toHaveBeenCalledWith('pi_1');
    expect(holdMocks.releaseHold).toHaveBeenCalledWith('h1');
    // El hold nunca pasó a paying: el TTL normal lo gobierna hasta el release.
    expect(state.holdUpdate).not.toHaveBeenCalled();
  });

  it('INSERT de payments falla y el cancel best-effort también: igual aborta y libera', async () => {
    state.paymentsInsertError = { message: 'insert failed' };
    providerMocks.cancelPaymentSession.mockRejectedValue(new Error('cancel endpoint 404'));

    await expect(initCheckout(params)).rejects.toThrow('insert failed');

    expect(holdMocks.releaseHold).toHaveBeenCalledWith('h1');
  });

  it('la transición del hold a paying falla: aborta y libera el hold', async () => {
    state.holdUpdateError = { message: 'hold update failed' };

    await expect(initCheckout(params)).rejects.toThrow('hold update failed');

    expect(holdMocks.releaseHold).toHaveBeenCalledWith('h1');
  });
});
