import { safeRedirectPath } from './safe-redirect';

const MFA_SEGMENT = '/mfa';

/**
 * A dónde va el usuario después del segundo factor (spec 0049): el `redirectTo` validado, salvo que
 * apunte de nuevo a /mfa (con aal2, /mfa redirige al destino: sería un bucle).
 */
export function mfaDestination(redirectTo: string | undefined, locale: string): string {
  const fallback = `/${locale}/dashboard`;
  const target = safeRedirectPath(redirectTo, fallback);
  const path = target.split(/[?#]/)[0]!;
  return path.endsWith(MFA_SEGMENT) || path.includes(`${MFA_SEGMENT}/`) ? fallback : target;
}
