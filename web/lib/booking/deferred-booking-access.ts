import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { BookingStatus, PaymentStatus } from '@shared/constants/enums';
import { isAwaitingAuthentication, isCardUpdateOpen } from './deferred-booking-rules';

// Acceso a las páginas de la reserva que exponen la tarjeta o un intent (spec 0029 §5.9): la de
// actualización de tarjeta solo en `pending_minimum` con el plazo vigente, y la de 3DS solo con el
// cobro en vuelo esperando autenticación. Sobre una reserva cancelada no entregan nada.

type ServiceClient = SupabaseClient<Database>;

export const AccessDeniedReason = {
  Cancelled: 'cancelled',
  Unavailable: 'unavailable',
} as const;

export type AccessDenied = {
  ok: false;
  reason: (typeof AccessDeniedReason)[keyof typeof AccessDeniedReason];
};

const SELECT = `
  status, customer_external_id, card_last4, total_amount_cents, currency,
  recovery_deadline, awaiting_action_until,
  tour_instances!inner ( starts_at, tours!inner ( name_es, name_en ) ),
  payments ( external_payment_id, status )
`;

type Row = {
  status: string;
  customer_external_id: string | null;
  card_last4: string | null;
  total_amount_cents: number;
  currency: string;
  recovery_deadline: string | null;
  awaiting_action_until: string | null;
  tour_instances: { starts_at: string; tours: { name_es: string; name_en: string } };
  payments: { external_payment_id: string; status: string }[];
};

type BookingSummary = {
  totalAmountCents: number;
  currency: string;
  tourNameEs: string;
  tourNameEn: string;
};

export type CardUpdateTarget = BookingSummary & {
  customerId: string;
  cardLast4: string | null;
  recoveryDeadline: string | null;
};

export type AuthenticationTarget = BookingSummary & {
  paymentIntentId: string;
  awaitingActionUntil: string;
};

const UNAVAILABLE: AccessDenied = { ok: false, reason: AccessDeniedReason.Unavailable };
const CANCELLED: AccessDenied = { ok: false, reason: AccessDeniedReason.Cancelled };

async function loadRow(db: ServiceClient, bookingId: string): Promise<Row | null> {
  const { data, error } = await db
    .from('bookings')
    .select(SELECT)
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw new Error(`load deferred booking: ${error.message}`);
  return data as unknown as Row | null;
}

function summaryOf(row: Row): BookingSummary {
  return {
    totalAmountCents: row.total_amount_cents,
    currency: row.currency,
    tourNameEs: row.tour_instances.tours.name_es,
    tourNameEn: row.tour_instances.tours.name_en,
  };
}

export async function loadCardUpdateTarget(
  db: ServiceClient,
  bookingId: string,
  now: Date = new Date(),
): Promise<{ ok: true; target: CardUpdateTarget } | AccessDenied> {
  const row = await loadRow(db, bookingId);
  if (!row) return UNAVAILABLE;
  if (row.status === BookingStatus.Cancelled) return CANCELLED;
  if (!row.customer_external_id || !isCardUpdateOpen(row.status, row.recovery_deadline, now)) {
    return UNAVAILABLE;
  }
  return {
    ok: true,
    target: {
      ...summaryOf(row),
      customerId: row.customer_external_id,
      cardLast4: row.card_last4,
      recoveryDeadline: row.recovery_deadline,
    },
  };
}

export async function loadAuthenticationTarget(
  db: ServiceClient,
  bookingId: string,
  now: Date = new Date(),
): Promise<{ ok: true; target: AuthenticationTarget } | AccessDenied> {
  const row = await loadRow(db, bookingId);
  if (!row) return UNAVAILABLE;
  if (row.status === BookingStatus.Cancelled) return CANCELLED;
  const pending = row.payments.find((payment) => payment.status === PaymentStatus.Pending);
  const awaitingUntil = row.awaiting_action_until;
  if (!pending || !awaitingUntil || !isAwaitingAuthentication(row.status, awaitingUntil, now)) {
    return UNAVAILABLE;
  }
  return {
    ok: true,
    target: {
      ...summaryOf(row),
      paymentIntentId: pending.external_payment_id,
      awaitingActionUntil: awaitingUntil,
    },
  };
}
