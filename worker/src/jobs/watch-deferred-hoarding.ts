import { getDb } from '../db.js';
import { checkDeferredHoarding } from './deferred-hoarding.js';

// Job de la alerta de acaparamiento (spec 0048 §5.3); la lógica vive en deferred-hoarding.ts.
export async function watchDeferredHoarding(): Promise<void> {
  await checkDeferredHoarding(getDb());
}
