import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Cliente anon para el portal público (sin sesión ni cookies)
export function createSupabasePublicClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
