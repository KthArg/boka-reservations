import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCsp, cspHeaderName } from './csp';

const NONCE = 'dGVzdC1ub25jZQ==';
const SUPABASE_URL = 'https://abcxyz.supabase.co';

function directive(csp: string, name: string): string {
  const found = csp.split('; ').find((d) => d.startsWith(`${name} `) || d === name);
  if (!found) throw new Error(`directiva ausente: ${name}`);
  return found;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildCsp — script-src con nonce + strict-dynamic', () => {
  it('incluye el nonce y strict-dynamic en script-src', () => {
    const scriptSrc = directive(buildCsp(NONCE), 'script-src');
    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).toContain(`'strict-dynamic'`);
  });

  it('NO incluye unsafe-inline en script-src (objetivo del spec)', () => {
    expect(directive(buildCsp(NONCE), 'script-src')).not.toContain(`'unsafe-inline'`);
  });

  it('agrega unsafe-eval sólo fuera de producción (HMR)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(directive(buildCsp(NONCE), 'script-src')).toContain(`'unsafe-eval'`);
  });

  it('NO incluye unsafe-eval en producción', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(directive(buildCsp(NONCE), 'script-src')).not.toContain(`'unsafe-eval'`);
  });
});

describe('buildCsp — paridad de directivas con la CSP previa (sin pérdida)', () => {
  it('conserva las directivas no-script idénticas a la CSP de next.config', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL);
    const csp = buildCsp(NONCE);
    expect(directive(csp, 'default-src')).toBe(`default-src 'self'`);
    expect(directive(csp, 'style-src')).toBe(`style-src 'self' 'unsafe-inline'`);
    expect(directive(csp, 'img-src')).toBe(`img-src 'self' data: https:`);
    expect(directive(csp, 'font-src')).toBe(`font-src 'self' data:`);
    expect(directive(csp, 'frame-ancestors')).toBe(`frame-ancestors 'none'`);
    expect(directive(csp, 'base-uri')).toBe(`base-uri 'self'`);
    expect(directive(csp, 'form-action')).toBe(`form-action 'self'`);
    expect(directive(csp, 'object-src')).toBe(`object-src 'none'`);
  });

  it('arma connect-src con los orígenes de Supabase (http+ws), OnvoPay y Sentry', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL);
    const connectSrc = directive(buildCsp(NONCE), 'connect-src');
    expect(connectSrc).toContain(SUPABASE_URL);
    expect(connectSrc).toContain('wss://abcxyz.supabase.co');
    expect(connectSrc).toContain('https://sdk.onvopay.com');
    expect(connectSrc).toContain('https://api.onvopay.com');
    expect(connectSrc).toContain('https://*.sentry.io');
  });

  it('mantiene frame-src con OnvoPay (sdk + iframe del widget)', () => {
    const frameSrc = directive(buildCsp(NONCE), 'frame-src');
    expect(frameSrc).toContain('https://sdk.onvopay.com');
    expect(frameSrc).toContain('https://*.onvopay.com');
  });
});

describe('cspHeaderName — enforcing vs report-only', () => {
  it('por defecto emite la CSP como enforcing', () => {
    vi.stubEnv('CSP_REPORT_ONLY', '');
    expect(cspHeaderName()).toBe('content-security-policy');
  });

  it('con CSP_REPORT_ONLY=true usa el header report-only (rollout)', () => {
    vi.stubEnv('CSP_REPORT_ONLY', 'true');
    expect(cspHeaderName()).toBe('content-security-policy-report-only');
  });
});
