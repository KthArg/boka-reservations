import { describe, expect, it, vi } from 'vitest';

// Aislamos los plugins de build: sólo nos interesa el objeto de config base y su headers().
vi.mock('@sentry/nextjs', () => ({ withSentryConfig: (cfg: unknown) => cfg }));
vi.mock('next-intl/plugin', () => ({ default: () => (cfg: unknown) => cfg }));

import nextConfig from './next.config';

type HeaderEntry = { key: string };
type HeaderGroup = { headers: HeaderEntry[] };

describe('next.config — la CSP no vive acá (regresión doble-header, spec 0024)', () => {
  it('no emite ningún header Content-Security-Policy (única fuente: el middleware)', async () => {
    const cfg = nextConfig as { headers?: () => Promise<HeaderGroup[]> };
    const groups = (await cfg.headers?.()) ?? [];
    const keys = groups.flatMap((g) => g.headers.map((entry) => entry.key.toLowerCase()));
    expect(keys).not.toContain('content-security-policy');
    expect(keys).not.toContain('content-security-policy-report-only');
  });

  it('conserva los demás headers de seguridad estáticos', async () => {
    const cfg = nextConfig as { headers?: () => Promise<HeaderGroup[]> };
    const groups = (await cfg.headers?.()) ?? [];
    const keys = groups.flatMap((g) => g.headers.map((entry) => entry.key.toLowerCase()));
    expect(keys).toContain('strict-transport-security');
    expect(keys).toContain('x-content-type-options');
    expect(keys).toContain('x-frame-options');
    expect(keys).toContain('referrer-policy');
    expect(keys).toContain('permissions-policy');
  });
});
