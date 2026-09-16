import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnvopayHttp } from './http';
import { intentOperations } from './intents';

// Payment intents del adapter de OnvoPay (spec 0029 §5.6), con fetch simulado. La regla: el caller
// decide por el status del intent, nunca por el código HTTP del confirm.

const BASE = 'https://api.onvopay.test/v1';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const operations = () => intentOperations(createOnvopayHttp('onvo_test_secret', BASE));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('confirmWithPaymentMethod', () => {
  it('returns the declined status that OnvoPay answers with a 201', async () => {
    // Arrange
    const fetchMock = stubFetch(json({ id: 'pi_1', status: 'requires_payment_method' }, 201));

    // Act
    const intent = await operations().confirmWithPaymentMethod('pi_1', 'pm_1', 'https://x/return');

    // Assert
    expect(intent.status).toBe('requires_payment_method');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/payment-intents/pi_1/confirm`);
    expect(JSON.parse(init.body as string)).toEqual({
      paymentMethodId: 'pm_1',
      returnUrl: 'https://x/return',
    });
  });

  it('returns the authentication URL of a 3DS challenge', async () => {
    // Arrange
    stubFetch(
      json(
        {
          id: 'pi_1',
          status: 'requires_action',
          nextAction: { redirectToUrl: { url: 'https://bank/3ds' } },
        },
        201,
      ),
    );

    // Act
    const intent = await operations().confirmWithPaymentMethod('pi_1', 'pm_1', 'https://x');

    // Assert
    expect(intent).toMatchObject({ status: 'requires_action', redirectUrl: 'https://bank/3ds' });
  });

  it('reads the intent instead of confirming again when OnvoPay answers 400', async () => {
    // Arrange
    const fetchMock = stubFetch(
      json({ message: 'already succeeded' }, 400),
      json({ id: 'pi_1', status: 'succeeded', amount: 7000, currency: 'USD' }),
    );

    // Act
    const intent = await operations().confirmWithPaymentMethod('pi_1', 'pm_1', 'https://x');

    // Assert
    expect(intent).toMatchObject({ status: 'succeeded', amountCents: 7000, currency: 'USD' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(secondUrl).toBe(`${BASE}/payment-intents/pi_1`);
    expect(secondInit.method).toBe('GET');
  });

  it('throws on a server error, leaving the outcome for the caller to read', async () => {
    // Arrange
    stubFetch(json({}, 502));

    // Act
    const confirm = operations().confirmWithPaymentMethod('pi_1', 'pm_1', 'https://x');

    // Assert
    await expect(confirm).rejects.toThrow('OnvoPay confirmWithPaymentMethod error 502');
  });
});

describe('cancelPaymentSession', () => {
  it('accepts a successful cancel without a body', async () => {
    // Arrange
    stubFetch(new Response(null, { status: 204 }));

    // Act
    const cancel = operations().cancelPaymentSession('pi_1');

    // Assert
    await expect(cancel).resolves.toBeUndefined();
  });

  it('throws when OnvoPay refuses the cancel', async () => {
    // Arrange
    stubFetch(json({}, 409));

    // Act
    const cancel = operations().cancelPaymentSession('pi_1');

    // Assert
    await expect(cancel).rejects.toThrow('OnvoPay cancelPaymentSession error 409');
  });
});
