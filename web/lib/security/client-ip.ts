import { UNKNOWN_IP } from '@shared/constants/rate-limit';

const XFF_SEPARATOR = ',';

/**
 * IP real del cliente a partir del header `x-forwarded-for`.
 *
 * En Vercel el header lo inyecta y reescribe la plataforma: el PRIMER elemento es la IP
 * real del cliente y NO es spoofeable por el cliente cuando se corre detrás de Vercel.
 * Por eso se toma el primero (no el último). En local sin proxy el header puede faltar →
 * `UNKNOWN_IP`: el límite por IP queda laxo (no distingue clientes), pero el límite por
 * email/identidad sigue aplicando. No se confía en ningún otro header arbitrario del
 * cliente fuera de la cadena que pone la plataforma.
 */
export function getClientIp(forwardedFor: string | null | undefined): string {
  if (!forwardedFor) return UNKNOWN_IP;
  const first = forwardedFor.split(XFF_SEPARATOR)[0]?.trim();
  return first && first.length > 0 ? first : UNKNOWN_IP;
}
