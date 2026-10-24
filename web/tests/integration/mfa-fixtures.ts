// Segundo factor en los tests de integración (spec 0049). Desde …064, una sesión de admin o staff
// sin el segundo factor (aal1) no ve las tablas del panel: los tests que necesitan una sesión del
// panel la llevan a aal2 con `completeSecondFactor`. El código TOTP se calcula acá (RFC 6238,
// SHA-1, 6 dígitos, 30 s) para no sumar una dependencia.

import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BITS_PER_CHAR = 5;
const BITS_PER_BYTE = 8;
const STEP_SECONDS = 30;
const MS_PER_SECOND = 1000;
const DIGITS = 6;
const MODULO = 10 ** DIGITS;

function base32Decode(secret: string): Buffer {
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += BASE32.indexOf(char).toString(2).padStart(BITS_PER_CHAR, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + BITS_PER_BYTE <= bits.length; i += BITS_PER_BYTE) {
    bytes.push(parseInt(bits.slice(i, i + BITS_PER_BYTE), 2));
  }
  return Buffer.from(bytes);
}

/** Código TOTP de una clave base32 en el instante `atMs`. */
export function totp(secret: string, atMs = Date.now(), digits = DIGITS): string {
  const counter = Buffer.alloc(BITS_PER_BYTE);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / MS_PER_SECOND / STEP_SECONDS)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const value = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** digits).padStart(digits, '0');
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';

function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');
  return createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Factor enrolado por este archivo de tests, por usuario: varias sesiones lo reusan. */
const enrolled = new Map<string, { factorId: string; secret: string }>();

/**
 * Lleva a aal2 un cliente que ya inició sesión con contraseña. La primera vez por usuario borra
 * sus factores (el seed es compartido y no se puede fijar la clave) y enrola uno nuevo.
 */
export async function completeSecondFactor(client: SupabaseClient): Promise<void> {
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error(`mfa: sin sesión (${userError?.message})`);
  const userId = userData.user.id;

  let factor = enrolled.get(userId);
  if (!factor) {
    const admin = serviceClient();
    const { data: listed } = await admin.auth.admin.mfa.listFactors({ userId });
    for (const f of listed?.factors ?? []) {
      await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    }
    const { data, error } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `test-${crypto.randomUUID()}`,
    });
    if (error) throw new Error(`mfa enroll: ${error.message}`);
    factor = { factorId: data.id, secret: data.totp.secret };
    enrolled.set(userId, factor);
  }

  const { error } = await client.auth.mfa.challengeAndVerify({
    factorId: factor.factorId,
    code: totp(factor.secret),
  });
  if (error) throw new Error(`mfa verify: ${error.message}`);
}
