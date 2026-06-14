import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Cliente con service_role para operaciones que requieren bypassear RLS.
// Usar solo en código server-side (server actions, API routes).
export function createSupabaseServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
