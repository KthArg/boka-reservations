import 'server-only';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { PaymentStatus } from '@shared/constants/enums';
import type { AdminBookingDetail } from './admin-types';

const DETAIL_SELECT = `
  id, customer_name, customer_email,
  tickets_adult, tickets_child, tickets_student,
  total_amount_cents, currency, status, checked_in_at, created_at, updated_at,
  charge_attempts, card_last4, payment_method_id,
  tour_instances!inner ( starts_at, ends_at, tours!inner ( name_es ) ),
  payments ( status, external_provider ),
  notifications ( kind, status, sent_at ),
  refunds ( id, status, failure_reason )
`;

// Con varios pagos (spec 0029: un intento rechazado y otro vigente) el panel muestra el que decide
// el estado de la reserva, no el primero que devuelva la consulta.
const PAYMENT_STATUS_PRIORITY: readonly string[] = [
  PaymentStatus.Succeeded,
  PaymentStatus.Pending,
  PaymentStatus.Refunded,
  PaymentStatus.Failed,
];

type RawPayment = { status: string; external_provider: string };

interface RawDetail {
  id: string;
  customer_name: string;
  customer_email: string;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
  total_amount_cents: number;
  currency: string;
  status: string;
  checked_in_at: string | null;
  created_at: string;
  updated_at: string;
  charge_attempts: number;
  card_last4: string | null;
  payment_method_id: string | null;
  tour_instances: { starts_at: string; ends_at: string; tours: { name_es: string } | null } | null;
  payments: RawPayment[] | null;
  notifications: { kind: string; status: string; sent_at: string | null }[] | null;
  refunds: { id: string; status: string; failure_reason: string | null }[] | null;
}

function currentPayment(payments: RawPayment[] | null): RawPayment | null {
  const rows = payments ?? [];
  for (const status of PAYMENT_STATUS_PRIORITY) {
    const match = rows.find((payment) => payment.status === status);
    if (match) return match;
  }
  return rows[0] ?? null;
}

function toDetail(r: RawDetail): AdminBookingDetail {
  const payment = currentPayment(r.payments);
  return {
    id: r.id,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    tourName: r.tour_instances?.tours?.name_es ?? '',
    startsAt: r.tour_instances?.starts_at ?? '',
    endsAt: r.tour_instances?.ends_at ?? '',
    ticketsAdult: r.tickets_adult,
    ticketsChild: r.tickets_child,
    ticketsStudent: r.tickets_student,
    totalAmountCents: r.total_amount_cents,
    currency: r.currency,
    status: r.status,
    checkedInAt: r.checked_in_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    paymentStatus: payment?.status ?? null,
    paymentProvider: payment?.external_provider ?? null,
    chargeAttempts: r.charge_attempts,
    cardLast4: r.card_last4,
    hasSavedCard: r.payment_method_id !== null,
    notifications: (r.notifications ?? []).map((n) => ({
      kind: n.kind,
      status: n.status,
      sentAt: n.sent_at,
    })),
    refund: r.refunds?.[0]
      ? {
          id: r.refunds[0].id,
          status: r.refunds[0].status,
          failureReason: r.refunds[0].failure_reason,
        }
      : null,
  };
}

export async function getBookingDetailForAdmin(id: string): Promise<AdminBookingDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toDetail(data as unknown as RawDetail) : null;
}
