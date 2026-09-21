import type { SupabaseClient } from '@supabase/supabase-js';

const PENDING_PAYMENT_STATUS = 'pending_payment';

/** Outcome de la RPC confirm_booking (spec 0028). Espejo de
 *  shared/constants/enums.ts (el worker es self-contained: no importa @shared). */
export const ConfirmOutcome = {
  Confirmed: 'confirmed',
  /** Reserva diferida confirmada sin cobro iniciado (spec 0029 §5.3). */
  ConfirmedUnclaimed: 'confirmed_unclaimed',
  AlreadyProcessed: 'already_processed',
  LatePaymentRefunded: 'late_payment_refunded',
  /** Pago tardío con otro refund activo: no vuelve solo (spec 0029). */
  LatePaymentRefundBlocked: 'late_payment_refund_blocked',
  /** Segundo intent cobrado sobre una reserva ya resuelta (spec 0029 §5.6). */
  DuplicatePayment: 'duplicate_payment',
  OverbookedRefunded: 'overbooked_refunded',
  PaymentMismatch: 'payment_mismatch',
  Ignored: 'ignored',
} as const;

export type ConfirmOutcomeValue = (typeof ConfirmOutcome)[keyof typeof ConfirmOutcome];

export type StalePendingBooking = {
  id: string;
  tour_instance_id: string;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
  created_at: string;
  // Embed de PostgREST: hoy 0 o 1 fila de pago (el checkout inserta una sola). Es
  // un array porque la relación es 1-a-N a nivel schema; se ordena por created_at
  // desc para que payments[0] sea determinista si alguna vez hubiera más de una.
  // amount_cents/currency = monto esperado, para validar contra OnvoPay (spec 0014).
  payments: {
    external_payment_id: string;
    status: string;
    created_at: string;
    amount_cents: number;
    currency: string;
  }[];
};

/**
 * Reservas en `pending_payment` más viejas que el umbral, con su pago embebido
 * (si llegó a crearse). Ordenadas de más antigua a más nueva; lote acotado.
 */
export async function fetchStalePendingBookings(
  db: SupabaseClient,
  olderThanIso: string,
  limit: number,
): Promise<StalePendingBooking[]> {
  const { data, error } = await db
    .from('bookings')
    .select(
      'id, tour_instance_id, tickets_adult, tickets_child, tickets_student, created_at, payments(external_payment_id, status, created_at, amount_cents, currency)',
    )
    .eq('status', PENDING_PAYMENT_STATUS)
    // Un cobro diferido en vuelo es de watch-charges, no del reconciliador (spec 0029 §5.4).
    // La función SQL también lo gatea bajo lock; esto solo evita traerlo.
    .is('charge_started_at', null)
    .lt('created_at', olderThanIso)
    .order('created_at', { ascending: true })
    .order('created_at', { referencedTable: 'payments', ascending: false })
    .limit(limit)
    .returns<StalePendingBooking[]>();

  if (error) throw new Error(`fetch stale pending bookings: ${error.message}`);
  return data ?? [];
}

/**
 * Cancela atómicamente una reserva abandonada vía la función DB
 * `cancel_stale_pending_booking`. Devuelve true si la canceló, false si ya no
 * estaba en `pending_payment` (el webhook la confirmó en paralelo: idempotente).
 */
export async function cancelStaleBooking(
  db: SupabaseClient,
  bookingId: string,
  reason: string,
): Promise<boolean> {
  const { data, error } = (await db.rpc('cancel_stale_pending_booking', {
    p_booking_id: bookingId,
    p_reason: reason,
  })) as { data: boolean | null; error: { message: string } | null };
  if (error) throw new Error(`cancel stale booking: ${error.message}`);
  return data === true;
}

/**
 * Recupera una reserva pagada cuyo webhook se perdió, reusando la MISMA RPC que
 * el webhook (`confirm_booking`). Devuelve el outcome de la RPC (spec 0028) para
 * que el job alerte según lo que realmente pasó — reemplaza la re-lectura del
 * status. Los asientos los deriva la RPC de la propia reserva (p_total_seats
 * quedó deprecated y ya no se envía). Idempotente por estado.
 *
 * Pasa el monto/moneda pagados al guard de payment_mismatch interno de confirm_booking
 * (spec 0026, defensa en profundidad). `recover()` ya valida el monto antes de llegar acá:
 * pasarlos es redundante pero inofensivo. Sigue llamando SIN p_event_id (la idempotencia en
 * este camino la da el guard por estado + el índice único de refund activo).
 */
export async function confirmRecoveredBooking(
  db: SupabaseClient,
  bookingId: string,
  externalPaymentId: string,
  paidAmountCents: number,
  paidCurrency: string,
): Promise<ConfirmOutcomeValue | null> {
  const { data, error } = (await db.rpc('confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
    p_paid_amount_cents: paidAmountCents,
    p_paid_currency: paidCurrency,
  })) as { data: ConfirmOutcomeValue | null; error: { message: string } | null };
  if (error) throw new Error(`confirm recovered booking: ${error.message}`);
  return data ?? null;
}

/**
 * Marca una reserva como pago no coincidente (spec 0014) vía la función DB
 * `flag_payment_mismatch`. Devuelve true si la marcó, false si ya no estaba en
 * `pending_payment` (idempotente / race con el webhook).
 */
export async function flagPaymentMismatch(
  db: SupabaseClient,
  bookingId: string,
  paidAmountCents: number,
  paidCurrency: string,
): Promise<boolean> {
  const { data, error } = (await db.rpc('flag_payment_mismatch', {
    p_booking_id: bookingId,
    p_paid_amount_cents: paidAmountCents,
    p_paid_currency: paidCurrency,
    p_source: 'reconcile',
  })) as { data: boolean | null; error: { message: string } | null };
  if (error) throw new Error(`flag payment mismatch: ${error.message}`);
  return data === true;
}

/**
 * Bitácora de la recuperación. La escribe el job (no `confirm_booking`, que no
 * audita): best-effort y no transaccional con la confirmación. Un fallo del INSERT
 * NO debe abortar la recuperación: si abortara, la reserva ya está `confirmed` y
 * nunca se reintentaría, perdiendo la traza en silencio. Se loggea en su lugar.
 */
export async function writeRecoveredAudit(
  db: SupabaseClient,
  bookingId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from('audit_logs').insert({
    actor_type: 'system',
    action: 'booking.recovered_via_reconcile',
    entity_type: 'booking',
    entity_id: bookingId,
    metadata,
  });
  if (error) {
    console.error('[reconcile] audit recovered falló (no aborta):', error.message);
  }
}
