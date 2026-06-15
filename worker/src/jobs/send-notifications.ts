import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import { getEmailAdapter } from '../notifications/adapters/index.js';
import { prepareBookingEmail, prepareGuideEmail } from '../notifications/prepare.js';
import {
  prepareCancellationEmail,
  prepareOverbookedEmail,
  prepareRefundEmail,
} from '../notifications/prepare-cancellation.js';
import {
  cancelNotification,
  fetchPending,
  handleTransient,
  markFailed,
  markSent,
  type NotificationRow,
} from '../notifications/repository.js';
import {
  CANCELLATION_CONFIRMATION_KIND,
  EmailPermanentError,
  EmailTransientError,
  GUIDE_ASSIGNMENT_KIND,
  OVERBOOKED_REFUNDED_KIND,
  REFUND_CONFIRMATION_KIND,
  type EmailAdapter,
  type RenderedEmail,
} from '../notifications/types.js';

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
  const prepared = await prepareForKind(db, notif);

  if (!prepared.ok) {
    await cancelNotification(db, notif.id, prepared.reason);
    return;
  }
  await deliver(db, adapter, notif, prepared.email);
}

function prepareForKind(db: SupabaseClient, notif: NotificationRow) {
  switch (notif.kind) {
    case GUIDE_ASSIGNMENT_KIND:
      return prepareGuideEmail(db, notif, env.APP_URL);
    case CANCELLATION_CONFIRMATION_KIND:
      return prepareCancellationEmail(db, notif, env.APP_URL);
    case REFUND_CONFIRMATION_KIND:
      return prepareRefundEmail(db, notif);
    case OVERBOOKED_REFUNDED_KIND:
      return prepareOverbookedEmail(db, notif);
    default:
      return prepareBookingEmail(db, notif, env.APP_URL);
  }
}

async function deliver(
  db: SupabaseClient,
  adapter: EmailAdapter,
  notif: NotificationRow,
  email: RenderedEmail,
): Promise<void> {
  try {
    const result = await adapter.send({
      to: notif.recipient_email,
      subject: email.subject,
      html: email.html,
      text: email.text,
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

export const __testing = { processOne };
