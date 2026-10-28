// Verificación del captcha del checkout (spec 0048 §5.4 y §10): fetch a Cloudflare simulado. Falla
// cerrado ante cualquier duda: token vacío, hostname o acción ajenos, token repetido o Cloudflare
// sin responder.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptchaAction } from '@shared/constants/captcha';

const REAL_SECRET = '0x4AAAAAAAreal-secret-of-the-operator';
const TEST_SECRET = '1x0000000000000000000000000000000AA';
const HOST = 'reservas.bokaverdecr.com';

const state = vi.hoisted(() => ({
  enabled: 'true',
  secret: '0x4AAAAAAAreal-secret-of-the-operator',
  hostnames: 'reservas.bokaverdecr.com, boka-reservations-git-dev.vercel.app',
  headers: new Headers({ 'x-real-ip': '203.0.113.7' }),
}));
const alert = vi.hoisted(() => vi.fn());

vi.mock('@/lib/env', () => ({
  env: {
    get CAPTCHA_ENABLED() {
      return state.enabled;
    },
    get TURNSTILE_SECRET_KEY() {
      return state.secret;
    },
    get TURNSTILE_ALLOWED_HOSTNAMES() {
      return state.hostnames;
    },
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAAsitekey',
  },
  isTurnstileTestSecret: (secret: string) => /^[123]x0{31}AA$/.test(secret),
}));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(state.headers) }));
vi.mock('@/lib/booking/sentry-alert', () => ({ captureAlert: alert }));

const { captchaSiteKey, verifyCaptcha } = await import('./captcha');

const fetchMock = vi.fn();

function cloudflareSays(body: Record<string, unknown>, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

function sentBody(): URLSearchParams {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return init.body as URLSearchParams;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  state.enabled = 'true';
  state.secret = REAL_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  alert.mockReset();
});

describe('verifyCaptcha', () => {
  it('acepta un token que Cloudflare confirma para el sitio y la acción', async () => {
    cloudflareSays({ success: true, hostname: HOST, action: 'deferred_start' });

    await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(true);

    const body = sentBody();
    expect(body.get('secret')).toBe(REAL_SECRET);
    expect(body.get('response')).toBe('token');
    expect(body.get('remoteip')).toBe('203.0.113.7');
  });

  it('no manda la IP cuando no se conoce', async () => {
    state.headers = new Headers();
    cloudflareSays({ success: true, hostname: HOST, action: 'deferred_start' });

    await verifyCaptcha('token', CaptchaAction.DeferredStart);

    state.headers = new Headers({ 'x-real-ip': '203.0.113.7' });
    expect(sentBody().has('remoteip')).toBe(false);
  });

  it('acepta otro hostname de la lista', async () => {
    cloudflareSays({
      success: true,
      hostname: 'boka-reservations-git-dev.vercel.app',
      action: 'deferred_start',
    });

    await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(true);
  });

  it('rechaza un token resuelto en otro sitio y avisa (puede ser la variable mal escrita)', async () => {
    cloudflareSays({ success: true, hostname: 'evil.example', action: 'deferred_start' });

    await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(false);
    expect(alert).toHaveBeenCalledWith(
      expect.any(String),
      'captcha-misconfigured',
      { reason: 'hostname', hostname: 'evil.example' },
      'error',
    );
  });

  it.each(['invalid-input-secret', 'missing-input-secret'])(
    'avisa cuando Cloudflare rechaza el secreto (%s)',
    async (code) => {
      cloudflareSays({ success: false, 'error-codes': [code] });

      await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(false);
      expect(alert).toHaveBeenCalledWith(
        expect.any(String),
        'captcha-misconfigured',
        { reason: code },
        'error',
      );
    },
  );

  it('falla cerrado y alerta si la respuesta no es JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));

    await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(false);
    expect(alert).toHaveBeenCalledWith(expect.any(String), 'captcha-siteverify-unavailable', {
      reason: 'SyntaxError',
    });
  });

  it('rechaza un token de otra acción', async () => {
    cloudflareSays({ success: true, hostname: HOST, action: 'checkout' });

    await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(false);
  });

  it.each(['timeout-or-duplicate', 'invalid-input-response'])(
    'rechaza un token vencido o repetido (%s) sin alertar',
    async (code) => {
      cloudflareSays({ success: false, 'error-codes': [code] });

      await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(false);
      expect(alert).not.toHaveBeenCalled();
    },
  );

  it('falla cerrado y alerta si Cloudflare no responde a tiempo', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));

    await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(false);
    expect(alert).toHaveBeenCalledWith(expect.any(String), 'captcha-siteverify-unavailable', {
      reason: 'TimeoutError',
    });
  });

  it('falla cerrado y alerta ante un error de Cloudflare', async () => {
    cloudflareSays({}, 503);

    await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(false);
    expect(alert).toHaveBeenCalledWith(expect.any(String), 'captcha-siteverify-unavailable', {
      reason: 'http-503',
    });
  });

  it('alerta cuando Cloudflare informa un error interno', async () => {
    cloudflareSays({ success: false, 'error-codes': ['internal-error'] });

    await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(false);
    expect(alert).toHaveBeenCalledOnce();
  });

  it('rechaza sin token y sin llamar a Cloudflare', async () => {
    await expect(verifyCaptcha(null, CaptchaAction.DeferredStart)).resolves.toBe(false);
    await expect(verifyCaptcha('', CaptchaAction.DeferredStart)).resolves.toBe(false);
    await expect(verifyCaptcha('x'.repeat(2049), CaptchaAction.DeferredStart)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    // 2048 es el máximo de Cloudflare: ese sí se manda.
    cloudflareSays({ success: true, hostname: HOST, action: 'deferred_start' });
    await expect(verifyCaptcha('x'.repeat(2048), CaptchaAction.DeferredStart)).resolves.toBe(true);
  });

  it('con el captcha apagado no verifica nada', async () => {
    state.enabled = 'false';

    await expect(verifyCaptcha(null, CaptchaAction.DeferredStart)).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(captchaSiteKey()).toBeNull();
  });

  it('con una llave de prueba acepta la respuesta de prueba (hostname example.com, sin acción)', async () => {
    state.secret = TEST_SECRET;
    cloudflareSays({
      success: true,
      hostname: 'example.com',
      metadata: { result_with_testing_key: true },
    });

    await expect(verifyCaptcha('XXXX.DUMMY.TOKEN.XXXX', CaptchaAction.DeferredStart)).resolves.toBe(
      true,
    );
  });

  it('con la llave real no acepta una respuesta marcada como de prueba', async () => {
    cloudflareSays({
      success: true,
      hostname: 'example.com',
      metadata: { result_with_testing_key: true },
    });

    await expect(verifyCaptcha('token', CaptchaAction.DeferredStart)).resolves.toBe(false);
  });
});
