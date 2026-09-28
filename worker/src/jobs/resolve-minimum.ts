import * as Sentry from '@sentry/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';

// Cierre por mínimo del cobro inmediato (spec 0035). Los términos prometen avisar con al menos
// 24 h si una salida no alcanza su mínimo y devolver el 100 %. Cada 5 minutos se resuelven las
// salidas que empiezan dentro de 24 a 25 horas: la hora extra es margen para que el aviso salga
// antes del límite. Con menos de 24 h ya no se cancela por mínimo: la salida se hace y se alerta.
// Espeja las horas de resolve_immediate_minimum (…049); si cambia uno, cambian los dos.

const HOUR_MS = 60 * 60 * 1000;
const NOTICE_HOURS = 24;
const CUTOFF_HOURS = 25;
const BATCH_SIZE = 50;
const DEFERRED_STATUSES = ['pending_minimum', 'pending_payment', 'confirmed'];

export const MSG_MINIMUM_OVERDUE =
  '[resolve-minimum] salida bajo el mínimo sin resolver a menos de 24 h: se hace igual';

type DueInstance = { id: string };

type OverdueRow = {
  id: string;
  capacity_reserved: number;
  tour: { min_participants: number } | null;
};

/** Salidas que se alertan una sola vez por proceso: la issue de Sentry ya queda abierta. */
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
    .gt('starts_at', new Date(now.getTime() + NOTICE_HOURS * HOUR_MS).toISOString())
    .lte('starts_at', new Date(now.getTime() + CUTOFF_HOURS * HOUR_MS).toISOString())
    .order('starts_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(`resolve-minimum fetchDue: ${error.message}`);
  return data ?? [];
}

/** Salidas que llegaron a menos de 24 h sin resolverse y bajo el mínimo (worker caído). */
async function alertOverdue(db: SupabaseClient, now: Date): Promise<void> {
  const { data, error } = await db
    .from('tour_instances')
    .select('id, capacity_reserved, tour:tours!inner(min_participants)')
    .neq('status', 'cancelled')
    .is('minimum_resolved_at', null)
    .gt('starts_at', now.toISOString())
    .lte('starts_at', new Date(now.getTime() + NOTICE_HOURS * HOUR_MS).toISOString())
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

  for (const row of below) {
    if (deferredIds.has(row.id)) continue;
    alerted.add(row.id);
    Sentry.withScope((scope) => {
      scope.setLevel('error');
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
