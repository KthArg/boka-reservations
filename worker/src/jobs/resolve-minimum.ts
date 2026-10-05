import * as Sentry from '@sentry/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import { BelowMinimumPolicy, loadBelowMinimumPolicy } from '../charges/minimum-policy.js';

// Cierre por mínimo del cobro inmediato (spec 0035) y de las salidas vacías (spec 0045). Los
// términos prometen avisar con al menos 24 h si una salida se cancela por mínimo y devolver el
// 100 %. Cada 5 minutos se resuelven las salidas que empiezan dentro de 24 a 25 horas: la hora
// extra es margen para que el aviso salga antes del límite. Una salida sin reservas se cancela
// sola; una con reservas, solo si la política del negocio es `auto_cancel` (si no, decide el
// staff). Con menos de 24 h ya no se cancela por mínimo: la salida se hace y se alerta.
// Espeja las horas de resolve_immediate_minimum (…049); si cambia uno, cambian los dos.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const NOTICE_HOURS = 24;
// Margen sobre las 24 h: el aviso sale al minuto siguiente y tiene que llegar con 24 h o más.
const NOTICE_MARGIN_MINUTES = 10;
const NOTICE_MS = NOTICE_HOURS * HOUR_MS + NOTICE_MARGIN_MINUTES * MINUTE_MS;
const CUTOFF_HOURS = 25;
// Holgado: las salidas del cobro diferido vuelven en cada corrida sin resolverse (las decide su
// motor) y no pueden desplazar a las del cobro inmediato.
const BATCH_SIZE = 200;
const DEFERRED_STATUSES = ['pending_minimum', 'pending_payment', 'confirmed'];

export const MSG_MINIMUM_OVERDUE =
  '[resolve-minimum] salida bajo el mínimo sin resolver a menos de 24 h: se hace igual';

type DueInstance = { id: string };

type OverdueRow = {
  id: string;
  capacity_reserved: number;
  tour: { min_participants: number } | null;
};

/**
 * Salidas ya alertadas en este proceso. Es solo para no repetir el evento cada 5 minutos: la issue
 * de Sentry se agrupa por fingerprint, así que un reinicio del worker a lo sumo suma un evento.
 */
const alerted = new Set<string>();

type RpcOutcome = { data: string | null; error: { message: string } | null };

export async function resolveMinimum(): Promise<void> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  await runResolveMinimum(db, new Date());
}

export async function runResolveMinimum(db: SupabaseClient, now: Date): Promise<void> {
  const due = await fetchDue(db, now);
  const outcomes: Record<string, number> = {};
  for (const instance of due) {
    const { data, error } = (await db.rpc('resolve_immediate_minimum', {
      p_instance_id: instance.id,
    })) as RpcOutcome;
    if (error) {
      // Una salida que falla no frena a las demás; se reintenta en la corrida siguiente, que
      // todavía cae dentro de la ventana.
      console.error(`[resolve-minimum] ${instance.id}: ${error.message}`);
      Sentry.captureMessage(`[resolve-minimum] error al resolver ${instance.id}`, 'error');
      continue;
    }
    const outcome = String(data);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }

  await alertOverdue(db, now);
  console.log(`[resolve-minimum] ${due.length} salidas — ${JSON.stringify(outcomes)}`);
}

async function fetchDue(db: SupabaseClient, now: Date): Promise<DueInstance[]> {
  const { data, error } = await db
    .from('tour_instances')
    .select('id')
    .neq('status', 'cancelled')
    .is('minimum_resolved_at', null)
    .gt('starts_at', new Date(now.getTime() + NOTICE_MS).toISOString())
    .lte('starts_at', new Date(now.getTime() + CUTOFF_HOURS * HOUR_MS).toISOString())
    .order('starts_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(`resolve-minimum fetchDue: ${error.message}`);
  return data ?? [];
}

/**
 * Salidas que llegaron a menos de 24 h sin resolverse y bajo el mínimo. Con cupos cobrados y la
 * política `staff_decides` es una decisión que nadie tomó (warning); en cualquier otro caso el
 * proceso tendría que haberla cancelado (worker caído: error).
 */
async function alertOverdue(db: SupabaseClient, now: Date): Promise<void> {
  const { data, error } = await db
    .from('tour_instances')
    .select('id, capacity_reserved, tour:tours!inner(min_participants)')
    .neq('status', 'cancelled')
    .is('minimum_resolved_at', null)
    .gt('starts_at', now.toISOString())
    .lte('starts_at', new Date(now.getTime() + NOTICE_MS).toISOString())
    .limit(BATCH_SIZE);
  if (error) throw new Error(`resolve-minimum alertOverdue: ${error.message}`);

  const below = ((data ?? []) as unknown as OverdueRow[]).filter(
    (row) =>
      !alerted.has(row.id) &&
      row.tour !== null &&
      row.tour.min_participants > 1 &&
      row.capacity_reserved < row.tour.min_participants,
  );
  if (below.length === 0) return;

  // Las del cobro diferido las resuelve su propio motor (spec 0033): no son atrasos de este job.
  const { data: deferred, error: deferredError } = await db
    .from('bookings')
    .select('tour_instance_id')
    .in(
      'tour_instance_id',
      below.map((row) => row.id),
    )
    .not('payment_method_id', 'is', null)
    .in('status', DEFERRED_STATUSES);
  if (deferredError) throw new Error(`resolve-minimum deferred: ${deferredError.message}`);
  const deferredIds = new Set((deferred ?? []).map((row) => row.tour_instance_id as string));

  const staffDecides = (await loadBelowMinimumPolicy(db)) === BelowMinimumPolicy.StaffDecides;

  for (const row of below) {
    if (deferredIds.has(row.id)) continue;
    alerted.add(row.id);
    Sentry.withScope((scope) => {
      scope.setLevel(staffDecides && row.capacity_reserved > 0 ? 'warning' : 'error');
      scope.setFingerprint(['resolve-minimum-overdue', row.id]);
      scope.setExtra('instanceId', row.id);
      scope.setExtra('seats', row.capacity_reserved);
      scope.setExtra('minimum', row.tour?.min_participants);
      Sentry.captureMessage(MSG_MINIMUM_OVERDUE);
    });
  }
}

/** Solo para tests: el registro de alertas es por proceso. */
export function resetOverdueAlertsForTest(): void {
  alerted.clear();
}
