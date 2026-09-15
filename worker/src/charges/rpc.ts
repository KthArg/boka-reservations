import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfirmOutcomeValue } from '../reconciliation/repository.js';
import type { ClosedIntentStatus } from './decide.js';

// Wrappers de las funciones SQL del cobro diferido (migración …044). Toda transición de estado
// pasa por estas funciones bajo lock; los jobs nunca hacen UPDATE de status directo. Las de
// resultado llevan el intent: una respuesta vieja no puede tocar el intento actual (§5.6).

// Un solo espejo de los outcomes de confirm_booking en el worker (el worker no importa @shared).
export { ConfirmOutcome, type ConfirmOutcomeValue } from '../reconciliation/repository.js';

export const CancelInFlightReason = {
  ActionExpired: 'action_expired',
  RecoveryExpired: 'recovery_expired',
  DepartureStarted: 'departure_started',
} as const;

export type CancelInFlightReasonValue =
  (typeof CancelInFlightReason)[keyof typeof CancelInFlightReason];

export const CancelUnpaidReason = {
  RecoveryExpired: 'recovery_expired',
  DepartureStarted: 'departure_started',
} as const;

export type CancelUnpaidReasonValue = (typeof CancelUnpaidReason)[keyof typeof CancelUnpaidReason];

export const CancelUnpaidOutcome = {
  Cancelled: 'cancelled',
  ChargeInFlight: 'charge_in_flight',
  NotCancellable: 'not_cancellable',
} as const;

export type CancelUnpaidOutcomeValue =
  (typeof CancelUnpaidOutcome)[keyof typeof CancelUnpaidOutcome];

type RpcResult<T> = { data: T | null; error: { message: string } | null };

async function call<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = (await db.rpc(fn, args)) as RpcResult<T>;
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Rechazo de ESE intent; false si ya no es el cobro en vuelo (idempotente, respuesta vieja). */
export function recordAttemptFailed(
  db: SupabaseClient,
  bookingId: string,
  externalPaymentId: string,
  errorCode: string,
  intentTerminal: boolean,
): Promise<boolean> {
  return call<boolean>(db, 'charge_attempt_failed', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
    p_error_code: errorCode,
    p_intent_terminal: intentTerminal,
  });
}

export function registerRequiresAction(
  db: SupabaseClient,
  bookingId: string,
  externalPaymentId: string,
): Promise<boolean> {
  return call<boolean>(db, 'charge_requires_action', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
  });
}

export function cancelChargeInFlight(
  db: SupabaseClient,
  bookingId: string,
  reason: CancelInFlightReasonValue,
): Promise<boolean> {
  return call<boolean>(db, 'cancel_charge_in_flight', {
    p_booking_id: bookingId,
    p_reason: reason,
  });
}

export function cancelUnpaidBooking(
  db: SupabaseClient,
  bookingId: string,
  reason: CancelUnpaidReasonValue,
): Promise<CancelUnpaidOutcomeValue> {
  return call<CancelUnpaidOutcomeValue>(db, 'cancel_unpaid_booking', {
    p_booking_id: bookingId,
    p_actor_id: null,
    p_reason: reason,
  });
}

export function flagMismatch(
  db: SupabaseClient,
  bookingId: string,
  paidAmountCents: number,
  paidCurrency: string,
  source: string,
): Promise<boolean> {
  return call<boolean>(db, 'flag_payment_mismatch', {
    p_booking_id: bookingId,
    p_paid_amount_cents: paidAmountCents,
    p_paid_currency: paidCurrency,
    p_source: source,
  });
}

/**
 * Confirma un cobro liquidado con la misma clave de idempotencia que el webhook
 * (p_event_id = id del intent, ver web/lib/payments/adapters/onvopay/webhook.ts): si el webhook
 * llega después, recibe already_processed, y viceversa.
 */
export function confirmCharge(
  db: SupabaseClient,
  bookingId: string,
  externalPaymentId: string,
  paidAmountCents: number,
  paidCurrency: string,
): Promise<ConfirmOutcomeValue | null> {
  return call<ConfirmOutcomeValue | null>(db, 'confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
    p_event_id: externalPaymentId,
    p_paid_amount_cents: paidAmountCents,
    p_paid_currency: paidCurrency,
  });
}

/** Cierre comprobado por GET de un intent de una reserva cancelada (auditado bajo lock). */
export function recordIntentClosed(
  db: SupabaseClient,
  paymentId: string,
  intentStatus: ClosedIntentStatus,
): Promise<boolean> {
  return call<boolean>(db, 'record_intent_closed', {
    p_payment_id: paymentId,
    p_intent_status: intentStatus,
  });
}

/** Marca y audita el borrado del customer de un hold, ya hecho en OnvoPay. */
export function recordCustomerCleaned(
  db: SupabaseClient,
  holdId: string,
  detachedCount: number,
): Promise<boolean> {
  return call<boolean>(db, 'record_customer_cleaned', {
    p_hold_id: holdId,
    p_detached_count: detachedCount,
  });
}
