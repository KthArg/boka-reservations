import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';

/**
 * Locale de un route handler bajo `[locale]`. El parámetro llega decodificado, así que
 * `/%2Fevil.com/auth/confirm` da locale='/evil.com' y `new URL(`/${locale}/...`, origin)` arma una
 * URL protocol-relative (`//evil.com/...`): open redirect (auditoría 2026-10-18, APPSEC-1). Los
 * route handlers no pasan por el notFound() del layout, así que cada uno valida acá; un locale
 * desconocido cae al default.
 */
export function resolveRouteLocale(raw: string): string {
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}
