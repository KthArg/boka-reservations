import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationRow } from './repository.js';
import type { NotificationKind, PreparedEmail } from './types.js';
import { prepareBookingEmail, prepareGuideEmail } from './prepare.js';
import {
  prepareCancellationEmail,
  prepareOverbookedEmail,
  prepareRefundEmail,
} from './prepare-cancellation.js';
import {
  prepareChargeActionEmail,
  prepareRequiresActionEmail,
  prepareReservedEmail,
} from './prepare-deferred.js';

// Qué preparador corresponde a cada kind (spec 0029). Explícito y exhaustivo sobre el CHECK de
// notifications.kind: un kind nuevo sin su preparador no compila, y ninguno cae por defecto en la
// plantilla de reserva (que cancelaría un aviso de cobro por no estar `confirmed`).

export type Preparer = (
  db: SupabaseClient,
  notif: NotificationRow,
  appUrl: string,
) => Promise<PreparedEmail>;

const PREPARERS: Record<NotificationKind, Preparer | null> = {
  booking_confirmation: prepareBookingEmail,
  reminder_24h: prepareBookingEmail,
  guide_assignment: prepareGuideEmail,
  cancellation_confirmation: prepareCancellationEmail,
  refund_confirmation: (db, notif) => prepareRefundEmail(db, notif),
  overbooked_refunded: (db, notif) => prepareOverbookedEmail(db, notif),
  booking_reserved: prepareReservedEmail,
  charge_failed_action_required_1: prepareChargeActionEmail,
  charge_failed_action_required_2: prepareChargeActionEmail,
  charge_failed_action_required_3: prepareChargeActionEmail,
  charge_requires_action: prepareRequiresActionEmail,
  // Llega con el workstream C (cancelación de la salida por mínimo): todavía sin plantilla.
  departure_cancelled_minimum: null,
};

/** Preparador del kind, o null si este worker todavía no sabe enviarlo. */
export function preparerFor(kind: string): Preparer | null {
  return Object.prototype.hasOwnProperty.call(PREPARERS, kind)
    ? PREPARERS[kind as NotificationKind]
    : null;
}
