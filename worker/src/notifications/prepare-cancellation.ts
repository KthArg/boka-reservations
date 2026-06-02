import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationRow } from './repository.js';
import type { PreparedEmail } from './types.js';
import { loadBookingForNotification, loadLatestRefund } from './repository.js';
import { bookingViewUrl, localizedTourName } from './prepare.js';
import { renderCancellationConfirmation } from './templates/cancellation-confirmation.js';
import { renderRefundConfirmation } from './templates/refund-confirmation.js';

/** Email de confirmación de cancelación. La reserva ya NO está confirmada, así
 * que no aplica el guard de `prepareBookingEmail`. Informa el reembolso si hay. */
export async function prepareCancellationEmail(
  db: SupabaseClient,
  notif: NotificationRow,
  appUrl: string,
): Promise<PreparedEmail> {
  if (!notif.booking_id) return { ok: false, reason: 'booking-missing' };

  const booking = await loadBookingForNotification(db, notif.booking_id);
  if (!booking) return { ok: false, reason: 'booking-not-found' };

  const refund = await loadLatestRefund(db, booking.id);
  const url = await bookingViewUrl(db, booking, notif.locale, appUrl);

  const email = renderCancellationConfirmation(
    {
      customerName: booking.customer_name,
      tourName: localizedTourName(booking, notif.locale),
      startsAt: booking.tour_instance.starts_at,
      hasRefund: refund !== null,
      refundAmountCents: refund?.amountCents ?? 0,
      currency: refund?.currency ?? booking.currency,
      bookingUrl: url,
    },
    notif.locale,
  );
  return { ok: true, email };
}

/** Email de reembolso acreditado. Lo encola el job de refunds al cerrar en
 * succeeded, así que el reembolso existe. */
export async function prepareRefundEmail(
  db: SupabaseClient,
  notif: NotificationRow,
): Promise<PreparedEmail> {
  if (!notif.booking_id) return { ok: false, reason: 'booking-missing' };

  const booking = await loadBookingForNotification(db, notif.booking_id);
  if (!booking) return { ok: false, reason: 'booking-not-found' };

  const refund = await loadLatestRefund(db, booking.id);
  if (!refund) return { ok: false, reason: 'refund-not-found' };

  const email = renderRefundConfirmation(
    {
      customerName: booking.customer_name,
      tourName: localizedTourName(booking, notif.locale),
      refundAmountCents: refund.amountCents,
      currency: refund.currency,
    },
    notif.locale,
  );
  return { ok: true, email };
}
