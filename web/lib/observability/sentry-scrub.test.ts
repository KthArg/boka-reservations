import type { Event } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { scrubEvent, scrubUrl } from './sentry-scrub';

describe('scrubUrl', () => {
  it('quita el token del enlace de la reserva y del guía', () => {
    expect(scrubUrl('https://reservas.bokaverdecr.com/es/booking/abc123/cancel')).toBe(
      'https://reservas.bokaverdecr.com/es/booking/[token]/cancel',
    );
    expect(scrubUrl('/en/guide/xyz789')).toBe('/en/guide/[token]');
  });

  it('quita token_hash y code de los enlaces de Auth', () => {
    expect(scrubUrl('/es/auth/confirm?token_hash=pkce_abc&type=recovery')).toBe(
      '/es/auth/confirm?token_hash=[token]&type=recovery',
    );
    expect(scrubUrl('/es/auth/callback?code=123')).toBe('/es/auth/callback?code=[token]');
  });

  it('no toca las demás rutas', () => {
    expect(scrubUrl('/es/tours/hola/checkout?instance=1')).toBe(
      '/es/tours/hola/checkout?instance=1',
    );
  });
});

describe('scrubEvent', () => {
  it('limpia pedido, transacción y breadcrumbs, y recorta el usuario', () => {
    const event: Event = {
      user: { id: 'u-1', email: 'a@b.com' },
      request: { url: 'https://x/es/booking/abc/card', query_string: 'token_hash=abc' },
      transaction: '/es/booking/abc/card',
      breadcrumbs: [
        { category: 'navigation', data: { from: '/es/booking/abc', to: '/es/guide/def' } },
        { category: 'fetch', data: { url: 'https://x/es/booking/abc/cancel', status_code: 200 } },
      ],
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed.user).toEqual({ id: 'u-1' });
    expect(scrubbed.request?.url).toBe('https://x/es/booking/[token]/card');
    expect(scrubbed.request?.query_string).toBe('token_hash=[token]');
    expect(scrubbed.transaction).toBe('/es/booking/[token]/card');
    expect(scrubbed.breadcrumbs?.[0].data).toEqual({
      from: '/es/booking/[token]',
      to: '/es/guide/[token]',
    });
    expect(scrubbed.breadcrumbs?.[1].data?.url).toBe('https://x/es/booking/[token]/cancel');
  });
});
