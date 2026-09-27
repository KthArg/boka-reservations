import type { SupabaseClient } from '@supabase/supabase-js';

// Wrappers de las funciones SQL del ciclo de cobro de una salida (spec 0033, migración …047).
// Toda transición de estado pasa por esas funciones bajo lock; el job nunca hace UPDATE de status
// directo, igual que el resto del cobro diferido.

export type SeatCounts = {
  sold: number;
  authorized: number;
  captured: number;
  minimum: number;
};

type RpcResult<T> = { data: T | null; error: { message: string } | null };

async function call<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = (await db.rpc(fn, args)) as RpcResult<T>;
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export function departureChargeDue(db: SupabaseClient, instanceId: string): Promise<boolean> {
  return call<boolean>(db, 'departure_charge_due', { p_instance_id: instanceId });
}

export function departureSeatCounts(db: SupabaseClient, instanceId: string): Promise<SeatCounts> {
  return call<SeatCounts>(db, 'departure_seat_counts', { p_instance_id: instanceId });
}

export const OpenOutcome = {
  Opened: 'opened',
  AlreadyOpen: 'already_open',
  NotDue: 'not_due',
  NotChargeable: 'not_chargeable',
} as const;

export type OpenOutcomeValue = (typeof OpenOutcome)[keyof typeof OpenOutcome];

export function openDepartureCharge(
  db: SupabaseClient,
  instanceId: string,
): Promise<OpenOutcomeValue> {
  return call<OpenOutcomeValue>(db, 'open_departure_charge', { p_instance_id: instanceId });
}

export function closeDepartureCharge(db: SupabaseClient, instanceId: string): Promise<boolean> {
  return call<boolean>(db, 'close_departure_charge', { p_instance_id: instanceId });
}

export function recordAuthorization(
  db: SupabaseClient,
  bookingId: string,
  externalPaymentId: string,
): Promise<boolean> {
  return call<boolean>(db, 'record_authorization', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
  });
}

export function releaseAuthorization(
  db: SupabaseClient,
  bookingId: string,
  externalPaymentId: string,
): Promise<boolean> {
  return call<boolean>(db, 'release_departure_authorization', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
  });
}

export const DepartureResolution = {
  Reached: 'reached',
  AutoCancelled: 'auto_cancelled',
  StaffConfirmed: 'staff_confirmed',
  StaffCancelled: 'staff_cancelled',
} as const;

export type DepartureResolutionValue =
  (typeof DepartureResolution)[keyof typeof DepartureResolution];

export function resolveDepartureMinimum(
  db: SupabaseClient,
  instanceId: string,
  resolution: DepartureResolutionValue,
): Promise<string> {
  return call<string>(db, 'resolve_departure_minimum', {
    p_instance_id: instanceId,
    p_resolution: resolution,
  });
}

/**
 * Cierra la fila `pending` de un intent que ya no puede cobrar. Sin esto,
 * `charge_booking_start` responde `intent_mismatch` para siempre y la reserva no se vuelve a
 * intentar nunca: no suma al mínimo y la salida se cancela teniendo gente.
 */
export function closePendingPayment(
  db: SupabaseClient,
  bookingId: string,
  externalPaymentId: string,
): Promise<boolean> {
  return call<boolean>(db, 'close_pending_payment', {
    p_booking_id: bookingId,
    p_external_payment_id: externalPaymentId,
  });
}

/** `started` es el único outcome que habilita a confirmar con OnvoPay (spec 0029 §5.6). */
export async function startCharge(
  db: SupabaseClient,
  bookingId: string,
  intentId: string,
  paymentMethodId: string,
): Promise<boolean> {
  const outcome = await call<string>(db, 'charge_booking_start', {
    p_booking_id: bookingId,
    p_external_payment_id: intentId,
    p_payment_method_id: paymentMethodId,
  });
  return outcome === 'started';
}
