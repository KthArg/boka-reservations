import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// En dev detrás de un proxy (ngrok), el Origin del browser no coincide con el
// host local y Next bloquea los Server Actions por CSRF. Se permite ese origen
// vía env (NGROK_HOST) sin hardcodear la URL efímera. Vacío en local/prod normal.
const allowedOrigins = process.env.NGROK_HOST ? [process.env.NGROK_HOST] : undefined;

// Orígenes de Supabase para connect-src (REST/Auth por http(s), Realtime por ws(s)).
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : '';
const supabaseWs = supabaseOrigin.replace(/^http/, 'ws');
const onvoSdk = 'https://sdk.onvopay.com';
const onvoApi = 'https://api.onvopay.com';

// Content-Security-Policy (spec 0016, M-2). Permite lo que la app realmente carga:
// el SDK/widget de OnvoPay, Supabase y Sentry. `script-src`/`style-src` usan
// 'unsafe-inline' por los scripts de hidratación de Next 15/React 19 sin nonce;
// pasar a nonces (strict-dynamic) es un endurecimiento futuro (pregunta abierta §13).
// En dev se agrega 'unsafe-eval' porque Next lo necesita para HMR/React-refresh;
// en producción NO se incluye (CSP más estricta).
const scriptEval = process.env.NODE_ENV === 'production' ? '' : `'unsafe-eval'`;
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' ${scriptEval} ${onvoSdk}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: https:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs} ${onvoSdk} ${onvoApi} https://*.sentry.io`,
  `frame-src ${onvoSdk} https://*.onvopay.com`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
]
  .map((d) => d.replace(/\s+/g, ' ').trim())
  .join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
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
