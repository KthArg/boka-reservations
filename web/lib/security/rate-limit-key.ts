import { createHash } from 'node:crypto';

const KEY_SEPARATOR = ':';

/**
 * Hashea una identidad (email, IP) para la clave del rate limit, así no se guarda PII en
 * claro en el store. SHA-256 hex: no necesita ser anti-forgery (la clave la arma el
 * server), sólo opacar el identificador en reposo. Se normaliza (trim + lowercase) para
 * que `Foo@x.com` y `foo@x.com` caigan en la misma clave.
 */
export function hashIdentifier(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/** Construye la clave del store: `<prefijo>:<identidad-hasheada>`. */
export function rateLimitKey(prefix: string, identifier: string): string {
  return `${prefix}${KEY_SEPARATOR}${hashIdentifier(identifier)}`;
}
