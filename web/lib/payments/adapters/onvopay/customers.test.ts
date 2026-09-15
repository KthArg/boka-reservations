import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOnvopayHttp } from './http';
import { customerOperations } from './customers';

// Customers y métodos de pago del adapter de OnvoPay (spec 0029 §5.2), con fetch simulado.

const BASE = 'https://api.onvopay.test/v1';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const operations = () => customerOperations(createOnvopayHttp('onvo_test_secret', BASE));

afterEach(() => vi.unstubAllGlobals());

describe('createCustomer', () => {
  it('creates the customer with the secret key and returns its id', async () => {
    // Arrange
    const fetchMock = stubFetch(json({ id: 'cus_1' }, 201));

    // Act
    const result = await operations().createCustomer({ name: 'Ana', email: 'ana@example.com' });

    // Assert
    expect(result).toEqual({ customerId: 'cus_1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/customers`);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer onvo_test_secret' });
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Ana', email: 'ana@example.com' });
  });

  it('fails without copying the response body, which may echo personal data', async () => {
    // Arrange
    stubFetch(json({ message: 'invalid email ana@example.com' }, 422));

    // Act
    const creation = operations().createCustomer({ name: 'Ana', email: 'ana@example.com' });

    // Assert
    await expect(creation).rejects.toThrow('OnvoPay createCustomer error 422');
    await expect(
      operations()
        .createCustomer({ name: 'Ana', email: 'x' })
        .catch((err: Error) => err.message),
    ).resolves.not.toContain('ana@example.com');
  });
});

describe('getPaymentMethod', () => {
  it('maps the card data read by the server', async () => {
    // Arrange
    stubFetch(
      json({
        id: 'pm_1',
        status: 'attached',
        customerId: 'cus_1',
        card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
      }),
    );

    // Act
    const card = await operations().getPaymentMethod('pm_1');

    // Assert
    expect(card).toEqual({
      id: 'pm_1',
      status: 'attached',
      customerId: 'cus_1',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
  });

  it('leaves missing card data as null', async () => {
    // Arrange
    stubFetch(json({ id: 'pm_1' }));

    // Act
    const card = await operations().getPaymentMethod('pm_1');

    // Assert
    expect(card).toMatchObject({ customerId: null, last4: null, expMonth: null, expYear: null });
  });

  it('escapes an id that tries to reach another resource', async () => {
    // Arrange
    const fetchMock = stubFetch(json({ id: 'pm_1' }));

    // Act
    await operations().getPaymentMethod('../payment-intents/pi_1?x=1');

    // Assert
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${BASE}/payment-methods/..%2Fpayment-intents%2Fpi_1%3Fx%3D1`,
    );
  });

  it('rejects a response that is not a payment method', async () => {
    // Arrange
    stubFetch(json({ status: 'succeeded', amount: 100 }));

    // Act
    const read = operations().getPaymentMethod('pm_1');

    // Assert
    await expect(read).rejects.toThrow('respuesta inesperada');
  });
});

describe('detachPaymentMethod y deleteCustomer', () => {
  it('accepts a successful detach without a body', async () => {
    // Arrange
    stubFetch(new Response(null, { status: 204 }));

    // Act
    const detach = operations().detachPaymentMethod('pm_1');

    // Assert
    await expect(detach).resolves.toBeUndefined();
  });

  it('throws with the operation name when a detach fails', async () => {
    // Arrange
    stubFetch(json({}, 500));

    // Act
    const detach = operations().detachPaymentMethod('pm_1');

    // Assert
    await expect(detach).rejects.toThrow('OnvoPay detachPaymentMethod error 500');
  });

  it.each([
    [200, true],
    [404, true],
    [500, false],
  ])('deleting a customer answered with %i succeeds: %s', async (status, succeeds) => {
    // Arrange
    stubFetch(new Response(null, { status }));

    // Act
    const deletion = operations().deleteCustomer('cus_1');

    // Assert
    if (succeeds) await expect(deletion).resolves.toBeUndefined();
    else await expect(deletion).rejects.toThrow('OnvoPay deleteCustomer error 500');
  });
});
