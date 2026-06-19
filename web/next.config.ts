import path from 'node:path';
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
  // El build de Vercel (Root Directory = web, monorepo sin workspace de pnpm) no puede resolver
  // los TIPOS de las deps de terceros que usa `shared/` (p. ej. `zod` en shared/schemas.ts):
  // `shared/` no tiene node_modules propio y la raíz del repo no se instala en Vercel, así que
  // tsc no encuentra los tipos de zod desde shared/. El lint y el typecheck REALES corren en CI
  // ("Lint, typecheck y tests") sobre el repo completo en cada PR, ANTES de mergear a main; el
  // build de Vercel es post-merge/post-CI, así que acá se difieren para no fallar por ese falso
  // positivo de resolución. (La resolución de webpack para el bundle sí se arregla en `webpack` abajo.)
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // Monorepo sin workspace de pnpm: el código de `shared/` se importa vía el alias `@shared`,
  // pero `shared/` no tiene su propio node_modules. Sus imports de terceros (p. ej. `zod` en
  // shared/schemas.ts) deben resolverse contra `web/node_modules`. Al construir en Vercel con
  // Root Directory = web, webpack resuelve módulos desde la carpeta del archivo importador
  // (shared/) hacia arriba y NO encuentra `zod` → "Module not found". Agregar web/node_modules
  // (process.cwd() durante el build es la carpeta web) a resolve.modules lo arregla de raíz.
  webpack: (config) => {
    config.resolve.modules = [
      path.join(process.cwd(), 'node_modules'),
      ...(config.resolve.modules ?? ['node_modules']),
    ];
    return config;
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  disableLogger: true,
});
