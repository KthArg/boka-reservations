import type { SupabaseClient } from '@supabase/supabase-js';
import { isTerminalAfter, nextScheduledFor } from './backoff.js';
import type { BookingRow } from './render.js';
import type { EmailLocale, NotificationKind } from './types.js';

const BATCH_SIZE = 20;

export type NotificationRow = {
  id: string;
  booking_id: string | null;
  tour_instance_id: string | null;
  guide_id: string | null;
  kind: NotificationKind;
  recipient_email: string;
  locale: EmailLocale;
  attempts: number;
  scheduled_for: string;
};

export async function fetchPending(db: SupabaseClient): Promise<NotificationRow[]> {
  const { data, error } = await db
    .from('notifications')
    .select(
      'id, booking_id, tour_instance_id, guide_id, kind, recipient_email, locale, attempts, scheduled_for',
    )
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) throw new Error(`fetch notifications: ${error.message}`);
  return data ?? [];
}

export async function loadBookingForNotification(
  db: SupabaseClient,
  bookingId: string,
): Promise<BookingRow | null> {
  const { data, error } = await db
    .from('bookings')
    .select(
      'id, customer_name, customer_email, tickets_adult, tickets_child, tickets_student, total_amount_cents, currency, status, tour_instance:tour_instances!inner(starts_at, tour:tours!inner(name_es, name_en, meeting_point_es, meeting_point_en))',
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (error) throw new Error(`load booking: ${error.message}`);
  return (data as unknown as BookingRow | null) ?? null;
}

export type LatestRefund = { amountCents: number; currency: string };

/** Último reembolso de una reserva (cualquier estado). null si no hay. */
export async function loadLatestRefund(
  db: SupabaseClient,
  bookingId: string,
): Promise<LatestRefund | null> {
  const { data, error } = await db
    .from('refunds')
    .select('amount_cents, currency')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ amount_cents: number; currency: string }>();

  if (error) throw new Error(`load refund: ${error.message}`);
  return data ? { amountCents: data.amount_cents, currency: data.currency } : null;
}

export async function cancelNotification(
  db: SupabaseClient,
  id: string,
  reason: string,
): Promise<void> {
  await db
    .from('notifications')
    .update({ status: 'cancelled', cancelled_reason: reason })
    .eq('id', id)
    .eq('status', 'pending');
}

export async function markSent(
  db: SupabaseClient,
  id: string,
  provider: string,
  messageId: string,
): Promise<void> {
  await db
    .from('notifications')
    .update({
      status: 'sent',
      provider,
      provider_message_id: messageId,
      sent_at: new Date().toISOString(),
    })
    .eq('id', id);
}

export async function markFailed(
  db: SupabaseClient,
  id: string,
  provider: string,
  attempts: number,
  lastError: string,
): Promise<void> {
  await db
    .from('notifications')
    .update({ status: 'failed', provider, attempts, last_error: lastError })
    .eq('id', id);
}

export async function handleTransient(
  db: SupabaseClient,
  notif: NotificationRow,
  provider: string,
  lastError: string,
): Promise<void> {
  const nextAttempts = notif.attempts + 1;
  if (isTerminalAfter(nextAttempts)) {
    await markFailed(db, notif.id, provider, nextAttempts, lastError);
    return;
  }
  await db
    .from('notifications')
    .update({
      attempts: nextAttempts,
      scheduled_for: nextScheduledFor(notif.attempts).toISOString(),
      provider,
      last_error: lastError,
    })
    .eq('id', notif.id);
}
