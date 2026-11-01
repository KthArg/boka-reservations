import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Un solo cliente para todo el proceso. El worker corre sus jobs cada minuto: con un cliente por
// corrida, cada uno retenía ~12 KB que nunca se liberaban (medido el 2026-10-31) y la RAM en Railway
// subía sin parar hasta el siguiente deploy. Con la service role no hay sesión que renovar.
let client: SupabaseClient | undefined;

export function getDb(): SupabaseClient {
  client ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
