import { createHmac } from 'node:crypto';

const KEY_SEPARATOR = ':';

/** Solo fuera de producción: en producción el secreto es obligatorio (web/lib/env.ts). */
const DEVELOPMENT_SECRET = 'boka-development-identifier-hash-secret';

function identifierSecret(): string {
  const secret = process.env.IDENTIFIER_HASH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('IDENTIFIER_HASH_SECRET ausente');
  return DEVELOPMENT_SECRET;
}

/**
 * Huella de una identidad (email, IP) para la clave del rate limit (spec 0036). HMAC-SHA256 con
 * un secreto propio: la misma identidad da la misma clave, pero sin el secreto no se puede
 * recalcular. Un SHA-256 sin clave se revierte probando valores (hay 2³² IPv4), y el aviso de
 * privacidad promete que la IP se guarda en forma cifrada. Se normaliza (trim + lowercase) para
 * que `Foo@x.com` y `foo@x.com` caigan en la misma clave.
 */
export function hashIdentifier(value: string): string {
  return createHmac('sha256', identifierSecret()).update(value.trim().toLowerCase()).digest('hex');
}

/** Construye la clave del store: `<prefijo>:<identidad-hasheada>`. */
export function rateLimitKey(prefix: string, identifier: string): string {
  return `${prefix}${KEY_SEPARATOR}${hashIdentifier(identifier)}`;
}
