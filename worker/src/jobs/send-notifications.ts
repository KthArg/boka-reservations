import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/node';
import { env } from '../env.js';
import { getEmailAdapter } from '../notifications/adapters/index.js';
import { preparerFor } from '../notifications/dispatch.js';
import {
  cancelNotification,
  fetchPending,
  handleTransient,
  markFailed,
  markSent,
  postponeNotification,
  type NotificationRow,
} from '../notifications/repository.js';
import {
  EmailPermanentError,
  EmailTransientError,
  type EmailAdapter,
  type RenderedEmail,
} from '../notifications/types.js';

// Un kind que este worker todavía no sabe enviar se vuelve a mirar en una hora (spec 0029).
const UNSUPPORTED_KIND_RETRY_MS = 60 * 60 * 1000;

// Single-flight a nivel módulo (spec 0028): si el ciclo anterior sigue corriendo
// (p. ej. provider lento), este se saltea. Mismo patrón que el reconciliador.
let isRunning = false;

export async function sendNotifications(): Promise<void> {
  if (!env.NOTIFICATIONS_ENABLED) return;
  if (isRunning) {
    console.warn('[send-notifications] ciclo anterior en curso; se omite');
    return;
  }
  isRunning = true;
  try {
    await runCycle();
  } finally {
    isRunning = false;
  }
}

async function runCycle(): Promise<void> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const pending = await fetchPending(db);
  if (pending.length === 0) return;

  const adapter = getEmailAdapter();
  for (const notif of pending) {
    // Aislamiento por ítem / anti poison-pill (spec 0028): un throw inesperado (p. ej.
    // en prepare*) se registra como fallo transitorio de ESA notificación (attempts +
    // reprogramación con backoff) y el resto del lote continúa. Antes, una fila
    // envenenada reaparecía al frente de la cola cada minuto y bloqueaba TODO.
    try {
      await processOne(db, adapter, notif);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('[send-notifications] error en notificación', notif.id, message);
      Sentry.captureException(err);
      try {
        await handleTransient(db, notif, adapter.provider, message);
      } catch {
        // Best-effort: si ni reprogramar se pudo (DB caída), el próximo ciclo la retoma.
      }
    }
  }
}

async function processOne(
  db: SupabaseClient,
  adapter: EmailAdapter,
  notif: NotificationRow,
): Promise<void> {
  const prepare = preparerFor(notif.kind);
  if (!prepare) {
    await postponeUnsupported(db, notif);
    return;
  }

  const prepared = await prepare(db, notif, env.APP_URL);
  if (!prepared.ok) {
    await cancelNotification(db, notif.id, prepared.reason);
    return;
  }
  await deliver(db, adapter, notif, prepared.email);
}

/**
 * Un kind sin preparador no se cancela (se perdería el email si el worker quedó detrás de la DB)
 * ni se envía con otra plantilla: se pospone para no trabar la cola y se alerta.
 */
async function postponeUnsupported(db: SupabaseClient, notif: NotificationRow): Promise<void> {
  const until = new Date(Date.now() + UNSUPPORTED_KIND_RETRY_MS).toISOString();
  await postponeNotification(db, notif.id, until);
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setFingerprint(['notif-unsupported-kind', notif.kind]);
    scope.setExtra('notificationId', notif.id);
    Sentry.captureMessage('[send-notifications] kind sin plantilla en este worker');
  });
}

async function deliver(
  db: SupabaseClient,
  adapter: EmailAdapter,
  notif: NotificationRow,
  email: RenderedEmail,
): Promise<void> {
  let messageId: string;
  try {
    const result = await adapter.send({
      to: notif.recipient_email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: notif.id,
    });
    messageId = result.providerMessageId;
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

  // El email YA salió: si no se puede registrar, NO se reintenta el envío (evita el
  // duplicado); se alerta y la fila queda pending. El Idempotency-Key de Resend acota
  // el reenvío del próximo ciclo (spec 0028; con mailpit —solo dev— puede duplicar).
  try {
    await markSent(db, notif.id, adapter.provider, messageId);
  } catch (err) {
    Sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setFingerprint(['notif-mark-sent-failed']);
      scope.setExtra('notificationId', notif.id);
      scope.setExtra('providerMessageId', messageId);
      Sentry.captureMessage('[send-notifications] email enviado pero markSent falló');
    });
    console.error(
      '[send-notifications] markSent falló tras enviar',
      notif.id,
      err instanceof Error ? err.message : err,
    );
  }
}

export const __testing = { processOne };
