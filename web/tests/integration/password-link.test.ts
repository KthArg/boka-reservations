// Correo para fijar la contraseña (spec 0038): la plantilla de recuperación lleva un enlace a
// /auth/confirm con token_hash, que el servidor verifica con verifyOtp. Funciona tanto cuando lo
// pide el navegador (flujo PKCE, "¿Olvidaste tu contraseña?") como cuando lo manda el panel con
// el cliente de servicio (reenvío de acceso a una cuenta ya confirmada).
//
// PRECONDICIÓN: supabase/config.toml con [auth.email.template.recovery]; la config se carga en
// `supabase start` (no en `db reset`). Lee el correo desde Mailpit (puerto 54324).
// Requiere: supabase start. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

const MAIL_POLL_ATTEMPTS = 20;
const MAIL_POLL_MS = 250;
const TOKEN_HASH = /auth\/confirm\?token_hash=([^&"\s]+)&(?:amp;)?type=recovery/;

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Un cliente del navegador en flujo PKCE, con el code_verifier en memoria. */
function browserClient() {
  const memory = new Map<string, string>();
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false,
      storage: {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => void memory.set(key, value),
        removeItem: (key) => void memory.delete(key),
      },
    },
  });
}

async function confirmedAccount(): Promise<string> {
  const email = `clave-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const { error } = await admin.auth.admin.createUser({
    email,
    password: 'Prueba2026x',
    email_confirm: true,
    user_metadata: { locale: 'es' },
  });
  if (error) throw new Error(error.message);
  return email;
}

/** El token_hash del último correo de recuperación que recibió esa dirección. */
async function tokenHashFromMail(email: string): Promise<string> {
  for (let i = 0; i < MAIL_POLL_ATTEMPTS; i++) {
    const search = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`);
      const { HTML } = (await message.json()) as { HTML: string };
      const match = TOKEN_HASH.exec(HTML);
      if (!match) throw new Error('el correo no trae el enlace a /auth/confirm con token_hash');
      return decodeURIComponent(match[1]);
    }
    await new Promise((resolve) => setTimeout(resolve, MAIL_POLL_MS));
  }
  throw new Error(`no llegó el correo a ${email}`);
}

async function verifies(tokenHash: string): Promise<string | undefined> {
  // /auth/confirm usa un cliente de servidor distinto del que pidió el correo: se reproduce igual.
  const server = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await server.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  if (error) throw new Error(error.message);
  return data.user?.email;
}

describe('correo para fijar la contraseña (spec 0038)', () => {
  it('pedido desde el navegador (PKCE), el enlace se verifica en otro cliente', async () => {
    const email = await confirmedAccount();

    const { error } = await browserClient().auth.resetPasswordForEmail(email);

    expect(error).toBeNull();
    expect(await verifies(await tokenHashFromMail(email))).toBe(email);
  });

  it('enviado por el panel con el cliente de servicio, el enlace también se verifica', async () => {
    const email = await confirmedAccount();

    const { error } = await admin.auth.resetPasswordForEmail(email);

    expect(error).toBeNull();
    expect(await verifies(await tokenHashFromMail(email))).toBe(email);
  });
});
