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

describe('scrubEvent en headers, cookies y spans', () => {
  it('quita cookies y el estado del router, y limpia Referer y next-url', () => {
    const event: Event = {
      request: {
        url: 'https://x/es/booking/abc',
        cookies: { 'sb-auth-token': 'jwt' },
        headers: {
          Cookie: 'sb-auth-token=jwt; invite_set=x',
          Referer: 'https://x/es/booking/abc/cancel',
          'next-url': '/es/booking/abc',
          'next-router-state-tree': '%5B%22booking%22%2C%22abc%22%5D',
          'user-agent': 'test',
        },
      },
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.headers).toEqual({
      Referer: 'https://x/es/booking/[token]/cancel',
      'next-url': '/es/booking/[token]',
      'user-agent': 'test',
    });
  });

  it('limpia la descripción y los datos de los spans y de la traza', () => {
    const event = {
      type: 'transaction',
      spans: [
        {
          span_id: '1',
          trace_id: '2',
          start_timestamp: 0,
          description: 'GET /es/booking/abc?_rsc=1',
          data: { 'http.url': 'https://x/es/guide/def', 'url.full': 'https://x/es/booking/abc' },
        },
      ],
      contexts: { trace: { trace_id: '2', span_id: '1', data: { 'url.full': '/es/booking/abc' } } },
    } as unknown as Event;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.spans?.[0].description).toBe('GET /es/booking/[token]?_rsc=1');
    expect(scrubbed.spans?.[0].data).toEqual({
      'http.url': 'https://x/es/guide/[token]',
      'url.full': 'https://x/es/booking/[token]',
    });
    expect(scrubbed.contexts?.trace?.data).toEqual({ 'url.full': '/es/booking/[token]' });
  });
});
