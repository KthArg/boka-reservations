import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// En dev detrás de un proxy (ngrok), el Origin del browser no coincide con el
// host local y Next bloquea los Server Actions por CSRF. Se permite ese origen
// vía env (NGROK_HOST) sin hardcodear la URL efímera. Vacío en local/prod normal.
const allowedOrigins = process.env.NGROK_HOST ? [process.env.NGROK_HOST] : undefined;

// La Content-Security-Policy NO vive acá: se genera por request en el middleware
// (spec 0024) porque lleva un nonce único por respuesta (`web/lib/security/csp.ts`).
// Un header CSP estático acá y otro por request en el middleware se intersecarían;
// por eso la CSP es de una sola fuente (el middleware). Los headers de seguridad que
// NO dependen del request se quedan acá.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: allowedOrigins ? { allowedOrigins } : undefined,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  disableLogger: true,
});
