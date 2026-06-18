// Auto-registro deshabilitado (spec 0020, M-1(A)). La app es invite-only: el endpoint público
// de signup de GoTrue no debe permitir crear cuentas (un authenticated auto-registrado podía
// leer PII de los guías vía PostgREST). El alta legítima usa inviteUserByEmail (admin API), que
// NO pasa por este endpoint y sigue funcionando (cubierto por los tests de alta del 0010).
//
// PRECONDICIÓN: este test depende de supabase/config.toml con enable_signup=false. Ese flag
// solo se recarga con `supabase stop && start` (o el start inicial), NO con `db reset`. Si el
// stack no se reinició tras cambiar la config, este test lo delata (signup aún habilitado).
// Requiere: supabase start. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

describe('Auth — auto-registro deshabilitado (spec 0020, M-1(A))', () => {
  it('POST /auth/v1/signup es rechazado (no crea cuenta ni sesión)', async () => {
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await client.auth.signUp({
      email: `selfsignup-${crypto.randomUUID().slice(0, 8)}@example.com`,
      password: 'Attacker1234!',
    });

    // GoTrue con enable_signup=false responde error (p. ej. "Signups not allowed for this
    // instance") y no emite sesión. No se crea ninguna cuenta utilizable.
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });
});
