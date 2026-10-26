import { createClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import { checkDeferredHoarding } from './deferred-hoarding.js';

// Job de la alerta de acaparamiento (spec 0048 §5.3); la lógica vive en deferred-hoarding.ts.
export async function watchDeferredHoarding(): Promise<void> {
  await checkDeferredHoarding(
    createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
  );
}
