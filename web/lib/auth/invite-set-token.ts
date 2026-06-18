import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { INVITE_SET_TTL_MS } from '@shared/constants/users';

const SEPARATOR = '.';
const EXPECTED_PARTS = 3;

function secret(): string {
  // ACCESS-04 (spec 0023): secreto dedicado, no el service role key (la clave más sensible).
  const key = process.env.INVITE_SIGNING_SECRET;
  if (!key) throw new Error('INVITE_SIGNING_SECRET ausente');
  return key;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/**
 * Firma `<uid>.<exp>.<hmac>` para identificar al invitado que va a fijar su
 * contraseña (ver INVITE_SET_COOKIE). El uid (uuid) y el exp (dígitos) no
 * contienen el separador, así que el split es inequívoco.
 */
export function signInviteSet(uid: string, now: number = Date.now()): string {
  const exp = now + INVITE_SET_TTL_MS;
  const payload = `${uid}${SEPARATOR}${exp}`;
  return `${payload}${SEPARATOR}${sign(payload)}`;
}

/** Devuelve el uid si la firma es válida y no expiró; null en cualquier otro caso. */
export function verifyInviteSet(
  token: string | undefined,
  now: number = Date.now(),
): string | null {
  if (!token) return null;
  const parts = token.split(SEPARATOR);
  if (parts.length !== EXPECTED_PARTS) return null;

  const [uid, expStr, sig] = parts;
  const expected = sign(`${uid}${SEPARATOR}${expStr}`);
  const provided = Buffer.from(sig);
  const valid = Buffer.from(expected);
  if (provided.length !== valid.length || !timingSafeEqual(provided, valid)) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return null;
  return uid;
}
