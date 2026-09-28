import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingRow } from './render.js';
import type { NotificationRow } from './repository.js';
import type { LatestRefund } from './refund-repository.js';
import type { EmailLocale, PreparedEmail } from './types.js';
import { loadBookingForNotification } from './repository.js';
import { loadLatestRefund } from './refund-repository.js';
import { bookingViewUrl, localizedTourName } from './prepare.js';
import {
  renderDepartureCancelled,
  type DepartureOutcome,
} from './templates/departure-cancelled.js';
import { renderBookingRescheduled } from './templates/booking-rescheduled.js';
import { renderRefundTransferRequest } from './templates/refund-transfer-request.js';

// Avisos de la operación que prometen los términos (spec 0035): salida cancelada, cambio de fecha
// y pedido de datos para devolver por transferencia.

const TOURS_PATH_SEGMENT = 'tours';
const CONFIRMED_STATUS = 'confirmed';
const AWAITING_TRANSFER_STATUS = 'awaiting_transfer';
// El enlace de una reserva cancelada o con plata pendiente sigue vivo aunque la fecha pase.
const POST_CANCELLATION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function departureOutcome(booking: BookingRow, refund: LatestRefund | null): DepartureOutcome {
  if (booking.operator_review_required_at !== null) return { kind: 'review' };
  if (refund) {
    return { kind: 'refund', amountCents: refund.amountCents, currency: refund.currency };
  }
  return { kind: 'no_charge' };
}

async function load(
  db: SupabaseClient,
  notif: NotificationRow,
): Promise<{ ok: true; booking: BookingRow } | { ok: false; reason: string }> {
  if (!notif.booking_id) return { ok: false, reason: 'booking-missing' };
  const booking = await loadBookingForNotification(db, notif.booking_id);
  if (!booking) return { ok: false, reason: 'booking-not-found' };
  return { ok: true, booking };
}

/**
 * Salida cancelada por el operador. Lo encola cancel_departure, que ya canceló la reserva (o la
 * dejó en revisión) y encoló el reembolso: este es el único aviso de la cancelación.
 */
export async function prepareDepartureNoticeEmail(
  db: SupabaseClient,
  notif: NotificationRow,
  appUrl: string,
): Promise<PreparedEmail> {
  const loaded = await load(db, notif);
  if (!loaded.ok) return loaded;
  const { booking } = loaded;
  const reason = booking.tour_instance.cancellation_reason;
  if (reason === null) return { ok: false, reason: 'departure-not-cancelled' };

  const refund = await loadLatestRefund(db, booking.id);
  const email = renderDepartureCancelled(
    {
      customerName: booking.customer_name,
      tourName: localizedTourName(booking, notif.locale),
      startsAt: booking.tour_instance.starts_at,
      reason,
      outcome: departureOutcome(booking, refund),
      toursUrl: `${appUrl}/${notif.locale}/${TOURS_PATH_SEGMENT}`,
    },
    notif.locale,
  );
  return { ok: true, email };
}

function meetingPoint(booking: BookingRow, locale: EmailLocale): string {
  const tour = booking.tour_instance.tour;
  return locale === 'es' ? tour.meeting_point_es : tour.meeting_point_en;
}

/** Cambio de fecha: la reserva sigue confirmada, ahora en otra salida del mismo tour. */
export async function prepareRescheduledEmail(
  db: SupabaseClient,
  notif: NotificationRow,
  appUrl: string,
): Promise<PreparedEmail> {
  const loaded = await load(db, notif);
  if (!loaded.ok) return loaded;
  const { booking } = loaded;
  if (booking.status !== CONFIRMED_STATUS) {
    return { ok: false, reason: `booking-status-${booking.status}` };
  }

  const url = await bookingViewUrl(db, booking, notif.locale, appUrl);
  const email = renderBookingRescheduled(
    {
      customerName: booking.customer_name,
      tourName: localizedTourName(booking, notif.locale),
      startsAt: booking.tour_instance.starts_at,
      meetingPoint: meetingPoint(booking, notif.locale),
      bookingUrl: url,
    },
    notif.locale,
  );
  return { ok: true, email };
}

/** Pedido de datos de cuenta: solo mientras el reembolso siga esperando la transferencia. */
export async function prepareTransferRequestEmail(
  db: SupabaseClient,
  notif: NotificationRow,
  appUrl: string,
): Promise<PreparedEmail> {
  const loaded = await load(db, notif);
  if (!loaded.ok) return loaded;
  const { booking } = loaded;
  const refund = await loadLatestRefund(db, booking.id);
  if (refund?.status !== AWAITING_TRANSFER_STATUS) {
    return { ok: false, reason: 'refund-not-awaiting-transfer' };
  }

  const expiresAt = new Date(Date.now() + POST_CANCELLATION_TOKEN_TTL_MS).toISOString();
  const url = await bookingViewUrl(db, booking, notif.locale, appUrl, expiresAt);
  const email = renderRefundTransferRequest(
    {
      customerName: booking.customer_name,
      tourName: localizedTourName(booking, notif.locale),
      amountCents: refund.amountCents,
      currency: refund.currency,
      bookingUrl: url,
    },
    notif.locale,
  );
  return { ok: true, email };
}
