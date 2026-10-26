import { describe, expect, it } from 'vitest';
import { OnvopayHttpError, onvopayHttpError, redactOnvopayBody } from '../../src/onvopay-error.js';

describe('redactOnvopayBody', () => {
  it('redacta emails y secuencias largas de dígitos', () => {
    expect(redactOnvopayBody('{"email":"ana@example.com","card":"4242424242424242"}')).toBe(
      '{"email":"[email]","card":"[digits]"}',
    );
  });

  it('acota la longitud del cuerpo', () => {
    expect(redactOnvopayBody('x'.repeat(1000))).toHaveLength(300);
  });
});

describe('OnvopayHttpError', () => {
  it('arma el mensaje con la operación, el status y el cuerpo saneado', () => {
    const err = new OnvopayHttpError('createRefund', 400, 'bad request for ana@example.com');
    expect(err.message).toBe('onvopay createRefund 400: bad request for [email]');
    expect(err.isServerError).toBe(false);
  });

  it('marca los 5xx y el 408 como error del servidor (resultado ambiguo)', () => {
    expect(new OnvopayHttpError('getRefund', 503, '').isServerError).toBe(true);
    expect(new OnvopayHttpError('createRefund', 408, '').isServerError).toBe(true);
    expect(new OnvopayHttpError('createRefund', 429, '').isServerError).toBe(false);
  });

  it('onvopayHttpError conserva el status aunque el cuerpo no se pueda leer', async () => {
    const res = {
      status: 502,
      text: () => Promise.reject(new Error('stream')),
    } as unknown as Response;
    const err = await onvopayHttpError('createRefund', res);
    expect(err.message).toBe('onvopay createRefund 502: ');
    expect(err.isServerError).toBe(true);
  });
});
