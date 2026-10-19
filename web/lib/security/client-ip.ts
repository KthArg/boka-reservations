import { UNKNOWN_IP } from '@shared/constants/rate-limit';

const XFF_SEPARATOR = ',';

/** Mínimo necesario: lo cumplen tanto `Headers` (Request) como `ReadonlyHeaders` (next/headers). */
type HeaderGetter = { get(name: string): string | null };

function firstHop(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(XFF_SEPARATOR)[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/**
 * IP real del cliente. Detrás de Vercel se prefieren `x-vercel-forwarded-for` / `x-real-ip`
 * (los inyecta la plataforma y NO son spoofeables por el cliente); como fallback, el PRIMER
 * elemento de `x-forwarded-for` (INFRA-04, spec 0023). Sin ninguno → `UNKNOWN_IP`: el límite por
 * IP queda laxo (no distingue clientes), pero el límite por email/identidad sigue aplicando. No
 * se confía en ningún otro header arbitrario del cliente fuera de la cadena que pone la plataforma.
 *
 * En Vercel (`VERCEL=1`) el fallback a `x-forwarded-for` se descarta: su primer elemento lo
 * controla el cliente y, si faltaran los headers de la plataforma, rotarlo evadiría los límites
 * por IP (auditoría 2026-10-18, INFRA-06). Mejor `UNKNOWN_IP`, que agrupa en vez de dispersar.
 */
export function getClientIp(headers: HeaderGetter): string {
  const platformIp =
    firstHop(headers.get('x-vercel-forwarded-for')) ?? firstHop(headers.get('x-real-ip'));
  if (platformIp) return platformIp;
  if (process.env.VERCEL === '1') return UNKNOWN_IP;
  return firstHop(headers.get('x-forwarded-for')) ?? UNKNOWN_IP;
}
