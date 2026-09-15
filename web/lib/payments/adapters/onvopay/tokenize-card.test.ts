import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardTokenizationError, tokenizeOnvopayCard } from './tokenize-card';

// Tokenización desde el navegador (spec 0029 §5.2), con fetch simulado. La tarjeta viaja solo a
// OnvoPay y un error nunca lleva datos de la respuesta.

const CARD = {
  number: '4242424242424242',
  expMonth: 12,
  expYear: 2030,
  cvv: '123',
  holderName: 'Ana Pérez',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubFetch(response: Response | Error) {
  const fetchMock =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function failureOf(promise: Promise<unknown>) {
  const err = await promise.catch((error: unknown) => error);
  if (!(err instanceof CardTokenizationError)) throw new Error('se esperaba CardTokenizationError');
  return err;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_ONVOPAY_PUBLIC_KEY', 'onvo_test_publishable');
  vi.stubEnv('NEXT_PUBLIC_ONVOPAY_API_BASE_URL', 'https://api.onvopay.test/v1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('tokenizeOnvopayCard', () => {
  it('sends the card and the hold customer to OnvoPay with the publishable key', async () => {
    // Arrange
    const fetchMock = stubFetch(json({ id: 'pm_1' }, 201));

    // Act
    const paymentMethodId = await tokenizeOnvopayCard(CARD, 'cus_1');

    // Assert
    expect(paymentMethodId).toBe('pm_1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.onvopay.test/v1/payment-methods');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer onvo_test_publishable' });
    expect(JSON.parse(init.body as string)).toMatchObject({
      type: 'card',
      card: { number: CARD.number, cvv: CARD.cvv, expMonth: 12, expYear: 2030 },
      customerId: 'cus_1',
    });
  });

  it('reports a card that OnvoPay rejected, without response details', async () => {
    // Arrange
    stubFetch(json({ code: 'cards.invalid_card_info', number: CARD.number }, 402));

    // Act
    const err = await failureOf(tokenizeOnvopayCard(CARD, 'cus_1'));

    // Assert
    expect(err.failure).toBe('rejected');
    expect(err.message).not.toContain(CARD.number);
  });

  it.each([
    ['a misconfigured key (401)', json({}, 401)],
    ['an OnvoPay outage (503)', json({}, 503)],
    ['a response without id', json({ status: 'ok' })],
    ['a network failure', new TypeError('fetch failed')],
  ])('reports %s as unavailable, not as a bad card', async (_case, response) => {
    // Arrange
    stubFetch(response);

    // Act
    const err = await failureOf(tokenizeOnvopayCard(CARD, 'cus_1'));

    // Assert
    expect(err.failure).toBe('unavailable');
  });
});
