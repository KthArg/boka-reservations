import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

// Loaders ESTÁTICOS por locale (no `import(\`../locales/${locale}.json\`)`). Un import dinámico con
// variable hace que webpack genere un "context module" que en runtime usa `__dirname` para ubicar
// los chunks; ese global no existe en el runtime Edge (middleware) y rompía el bundle a module-load
// con `ReferenceError: __dirname is not defined`. Con rutas estáticas, cada locale es su propio
// chunk y no se genera el context module.
const messageLoaders = {
  es: () => import('../locales/es.json'),
  en: () => import('../locales/en.json'),
} satisfies Record<(typeof routing.locales)[number], () => Promise<{ default: unknown }>>;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await messageLoaders[locale]()).default as Record<string, unknown>,
  };
});
