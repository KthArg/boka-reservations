import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from '@/types/database';

// Cliente con service_role para operaciones que requieren bypassear RLS.
// Usar solo en código server-side (server actions, API routes).
// Consume la env TIPADA (spec 0028, B11): nada de `process.env.X!` — si falta una
// variable, el proceso murió al boot (instrumentation.ts), no acá en runtime.
export function createSupabaseServiceClient() {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
