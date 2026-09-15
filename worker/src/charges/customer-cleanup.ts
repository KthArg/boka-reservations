import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnvopayChargeClient } from './onvopay.js';
import type { BatchWindow } from './batch-rotation.js';
import { isCustomerCleanupDue, type CleanupCandidateView } from './cleanup-decision.js';
import { recordCustomerCleaned } from './rpc.js';
import { HoldState } from './statuses.js';

// Limpieza de customers de OnvoPay (spec 0029 §5.2, §5.9). release-expired-holds no puede
// hacerlo: es un UPDATE masivo sin HTTP. Cada customer nace con un hold, así que la marca
// customer_cleaned_at vive en tour_holds.

/** Holds que ya no reservan cupo o cuya reserva se confirmó. */
const CANDIDATE_HOLD_STATUSES = [HoldState.Expired, HoldState.Released, HoldState.Converted];

export type CleanupCandidate = {
  id: string;
  status: string;
  customer_external_id: string;
  bookings: {
    status: string;
    tour_instance: { starts_at: string };
    payments: { status: string; provider_closed_at: string | null }[];
  }[];
};

/**
 * Candidatos por ventana rotativa: muchos todavía no corresponden (una reserva confirmada con la
 * salida por delante, un intent abierto) y un lote fijo de los más viejos no avanzaría nunca.
 */
export async function fetchCleanupCandidates(
  db: SupabaseClient,
  window: BatchWindow,
): Promise<CleanupCandidate[]> {
  const { data, error } = await db
    .from('tour_holds')
    .select(
      'id, status, customer_external_id, bookings(status, tour_instance:tour_instances!inner(starts_at), payments(status, provider_closed_at))',
    )
    .not('customer_external_id', 'is', null)
    .is('customer_cleaned_at', null)
    .in('status', CANDIDATE_HOLD_STATUSES)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(window.from, window.to)
    .returns<CleanupCandidate[]>();

  if (error) throw new Error(`fetch cleanup candidates: ${error.message}`);
  return data ?? [];
}

function toView(row: CleanupCandidate): CleanupCandidateView {
  return {
    holdStatus: row.status,
    bookings: row.bookings.map((booking) => ({
      status: booking.status,
      startsAt: booking.tour_instance.starts_at,
      payments: booking.payments.map((payment) => ({
        status: payment.status,
        providerClosedAt: payment.provider_closed_at,
      })),
    })),
  };
}

/**
 * Borra el customer de un hold si ya corresponde. `detach` explícito antes del DELETE: la
 * documentación no dice que borrar el customer desvincule sus métodos. Reintentable: si algo
 * falla, la marca no se escribe y el ciclo siguiente repite (detach y DELETE toleran repetirse).
 */
export async function cleanupCustomer(
  db: SupabaseClient,
  client: OnvopayChargeClient,
  row: CleanupCandidate,
  now: Date,
): Promise<boolean> {
  if (!isCustomerCleanupDue(toView(row), now)) return false;

  const methods = await client.listAttachedPaymentMethods(row.customer_external_id);
  for (const methodId of methods) await client.detachPaymentMethod(methodId);
  await client.deleteCustomer(row.customer_external_id);

  return recordCustomerCleaned(db, row.id, methods.length);
}
