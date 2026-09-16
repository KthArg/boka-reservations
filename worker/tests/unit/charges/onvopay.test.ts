import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOnvopayChargeClient } from '../../../src/charges/onvopay.js';

const BASE = 'https://api.onvopay.test/v1';

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('charges/onvopay — cliente HTTP', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads an intent with the secret key and maps amount and currency', async () => {
    // Arrange
    const fetchMock = stubFetch(
      json({ id: 'pi_1', status: 'succeeded', amount: 7000, currency: 'USD' }),
    );
    const client = createOnvopayChargeClient('onvo_test_secret', BASE);

    // Act
    const intent = await client.getIntent('pi_1');

    // Assert
    expect(intent).toEqual({ status: 'succeeded', amountCents: 7000, currency: 'USD' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/payment-intents/pi_1`);
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer onvo_test_secret' });
  });

  it('returns null for an intent that does not exist for this key (404)', async () => {
    // Arrange
    stubFetch(new Response('not found', { status: 404 }));

    // Act
    const intent = await createOnvopayChargeClient('secret', BASE).getIntent('pi_ajeno');

    // Assert
    expect(intent).toBeNull();
  });

  it('throws on any other non-ok response when reading an intent', async () => {
    // Arrange
    stubFetch(new Response('boom', { status: 500 }));

    // Act
    const read = createOnvopayChargeClient('secret', BASE).getIntent('pi_1');

    // Assert
    await expect(read).rejects.toThrow('onvopay getIntent 500');
  });

  it('throws when OnvoPay rejects a cancel', async () => {
    // Arrange
    stubFetch(new Response('not cancelable', { status: 400 }));

    // Act
    const cancel = createOnvopayChargeClient('secret', BASE).cancelIntent('pi_1');

    // Assert
    await expect(cancel).rejects.toThrow('onvopay cancelIntent 400');
  });

  it('lists only the payment methods that are still attached', async () => {
    // Arrange
    stubFetch(
      json([
        { id: 'pm_attached', status: 'attached' },
        { id: 'pm_detached', status: 'detached' },
        { id: 'pm_no_status' },
      ]),
    );

    // Act
    const methods = await createOnvopayChargeClient('secret', BASE).listAttachedPaymentMethods(
      'cus_1',
    );

    // Assert
    expect(methods).toEqual(['pm_attached', 'pm_no_status']);
  });

  it('treats a customer that no longer exists as having no payment methods', async () => {
    // Arrange
    stubFetch(new Response('not found', { status: 404 }));

    // Act
    const methods = await createOnvopayChargeClient('secret', BASE).listAttachedPaymentMethods(
      'cus_borrado',
    );

    // Assert
    expect(methods).toEqual([]);
  });

  it('throws when listing payment methods fails for another reason', async () => {
    // Arrange
    stubFetch(new Response('boom', { status: 502 }));

    // Act
    const list = createOnvopayChargeClient('secret', BASE).listAttachedPaymentMethods('cus_1');

    // Assert
    await expect(list).rejects.toThrow('onvopay listPaymentMethods 502');
  });

  it('throws when a detach fails', async () => {
    // Arrange
    stubFetch(new Response('boom', { status: 500 }));

    // Act
    const detach = createOnvopayChargeClient('secret', BASE).detachPaymentMethod('pm_1');

    // Assert
    await expect(detach).rejects.toThrow('onvopay detach 500');
  });

  it('treats deleting an already deleted customer as done', async () => {
    // Arrange
    stubFetch(new Response('not found', { status: 404 }));

    // Act
    const deletion = createOnvopayChargeClient('secret', BASE).deleteCustomer('cus_borrado');

    // Assert
    await expect(deletion).resolves.toBeUndefined();
  });

  it('throws when deleting a customer fails for another reason', async () => {
    // Arrange
    stubFetch(new Response('boom', { status: 500 }));

    // Act
    const deletion = createOnvopayChargeClient('secret', BASE).deleteCustomer('cus_1');

    // Assert
    await expect(deletion).rejects.toThrow('onvopay deleteCustomer 500');
  });
});
