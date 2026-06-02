import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// En dev detrás de un proxy (ngrok), el Origin del browser no coincide con el
// host local y Next bloquea los Server Actions por CSRF. Se permite ese origen
// vía env (NGROK_HOST) sin hardcodear la URL efímera. Vacío en local/prod normal.
const allowedOrigins = process.env.NGROK_HOST ? [process.env.NGROK_HOST] : undefined;

const nextConfig: NextConfig = {
  experimental: {
    serverActions: allowedOrigins ? { allowedOrigins } : undefined,
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  disableLogger: true,
});
