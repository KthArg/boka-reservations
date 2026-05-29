import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import type { EmailAdapter } from '../notifications/types.js';
import { getEmailAdapter } from '../notifications/adapters/index.js';
import { renderForKind } from '../notifications/render.js';
import {
  cancelNotification,
  fetchPending,
  handleTransient,
  loadBookingForNotification,
  markFailed,
  markSent,
  type NotificationRow,
} from '../notifications/repository.js';
import { EmailPermanentError, EmailTransientError } from '../notifications/types.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const STALE_AFTER_MS = MS_PER_HOUR;

export async function sendNotifications(): Promise<void> {
  if (!env.NOTIFICATIONS_ENABLED) return;

  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const pending = await fetchPending(db);
  if (pending.length === 0) return;

  const adapter = getEmailAdapter();
  for (const notif of pending) {
    await processOne(db, adapter, notif);
  }
}

async function processOne(
  db: SupabaseClient,
  adapter: EmailAdapter,
  notif: NotificationRow,
): Promise<void> {
  const booking = await loadBookingForNotification(db, notif.booking_id);
  if (!booking) {
    await cancelNotification(db, notif.id, 'booking-not-found');
    return;
  }
  if (booking.status !== 'confirmed') {
    await cancelNotification(db, notif.id, `booking-status-${booking.status}`);
    return;
  }
  if (isStale(booking.tour_instance.starts_at)) {
    await cancelNotification(db, notif.id, 'stale');
    return;
  }

  const rendered = renderForKind(notif.kind, notif.locale, booking, env.APP_URL);

  try {
    const result = await adapter.send({
      to: notif.recipient_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: notif.id,
    });
    await markSent(db, notif.id, adapter.provider, result.providerMessageId);
  } catch (err) {
    if (err instanceof EmailPermanentError) {
      await markFailed(db, notif.id, adapter.provider, notif.attempts + 1, err.message);
      return;
    }
    if (err instanceof EmailTransientError) {
      await handleTransient(db, notif, adapter.provider, err.message);
      return;
    }
    throw err;
  }
}

function isStale(startsAt: string): boolean {
  return Date.now() - new Date(startsAt).getTime() > STALE_AFTER_MS;
}

export const __testing = { processOne };
