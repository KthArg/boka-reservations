import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationRow } from './repository.js';
import type { PreparedEmail } from './types.js';
import { loadDeferredBooking, type DeferredBookingRow } from './deferred-repository.js';
import { bookingViewUrl, localizedTourName } from './prepare.js';
import { renderBookingReserved } from './templates/booking-reserved.js';
import { renderChargeActionRequired } from './templates/charge-action-required.js';
import { renderChargeRequiresAction } from './templates/charge-requires-action.js';

// Emails del ciclo del cobro diferido (spec 0029 §5.7, §9). Cada uno sale solo en el estado que le
// da sentido: una reserva que ya se confirmó, se canceló o está cobrándose de nuevo no recibe un
// aviso viejo. Los enlaces llevan un token propio que vence con el plazo del aviso (§5.7).

const PENDING_MINIMUM = 'pending_minimum';
const PENDING_PAYMENT = 'pending_payment';
/** Páginas de la reserva a las que llevan los avisos (web/app/[locale]/booking/[token]/…). */
const CARD_UPDATE_SEGMENT = 'card';
const AUTHENTICATE_SEGMENT = 'authenticate';

type Loaded = { ok: true; booking: DeferredBookingRow } | { ok: false; reason: string };

async function loadInStatus(
  db: SupabaseClient,
  notif: NotificationRow,
  statuses: readonly string[],
): Promise<Loaded> {
  if (!notif.booking_id) return { ok: false, reason: 'booking-missing' };
  const booking = await loadDeferredBooking(db, notif.booking_id);
  if (!booking) return { ok: false, reason: 'booking-not-found' };
  if (!statuses.includes(booking.status)) {
    return { ok: false, reason: `booking-status-${booking.status}` };
  }
  return { ok: true, booking };
}

function isFuture(iso: string | null): iso is string {
  return iso !== null && new Date(iso).getTime() > Date.now();
}

/** "Reserva registrada, sin cargo": mientras la reserva siga sin confirmarse. */
export async function prepareReservedEmail(
  db: SupabaseClient,
  notif: NotificationRow,
  appUrl: string,
): Promise<PreparedEmail> {
  const loaded = await loadInStatus(db, notif, [PENDING_MINIMUM, PENDING_PAYMENT]);
  if (!loaded.ok) return loaded;
  const { booking } = loaded;

  const email = renderBookingReserved(
    {
      customerName: booking.customer_name,
      tourName: localizedTourName(booking, notif.locale),
      startsAt: booking.tour_instance.starts_at,
      totalAmountCents: booking.total_amount_cents,
      currency: booking.currency,
      cardLast4: booking.card_last4 ?? '',
      bookingUrl: await bookingViewUrl(db, booking, notif.locale, appUrl),
    },
    notif.locale,
  );
  return { ok: true, email };
}

/** Tarjeta rechazada (_1, _2 y _3): solo con la reserva esperando y el plazo vigente. */
export async function prepareChargeActionEmail(
  db: SupabaseClient,
  notif: NotificationRow,
  appUrl: string,
): Promise<PreparedEmail> {
  const loaded = await loadInStatus(db, notif, [PENDING_MINIMUM]);
  if (!loaded.ok) return loaded;
  const { booking } = loaded;
  if (!isFuture(booking.recovery_deadline)) return { ok: false, reason: 'recovery-expired' };

  const view = await bookingViewUrl(db, booking, notif.locale, appUrl, booking.recovery_deadline);
  const email = renderChargeActionRequired(
    {
      customerName: booking.customer_name,
      tourName: localizedTourName(booking, notif.locale),
      startsAt: booking.tour_instance.starts_at,
      totalAmountCents: booking.total_amount_cents,
      currency: booking.currency,
      cardLast4: booking.card_last4 ?? '',
      deadline: booking.recovery_deadline,
      updateUrl: `${view}/${CARD_UPDATE_SEGMENT}`,
    },
    notif.locale,
  );
  return { ok: true, email };
}

/** 3DS: solo con el cobro en vuelo y el plazo de autenticación vigente. */
export async function prepareRequiresActionEmail(
  db: SupabaseClient,
  notif: NotificationRow,
  appUrl: string,
): Promise<PreparedEmail> {
  const loaded = await loadInStatus(db, notif, [PENDING_PAYMENT]);
  if (!loaded.ok) return loaded;
  const { booking } = loaded;
  if (!isFuture(booking.awaiting_action_until)) return { ok: false, reason: 'action-expired' };

  const view = await bookingViewUrl(
    db,
    booking,
    notif.locale,
    appUrl,
    booking.awaiting_action_until,
  );
  const email = renderChargeRequiresAction(
    {
      customerName: booking.customer_name,
      tourName: localizedTourName(booking, notif.locale),
      startsAt: booking.tour_instance.starts_at,
      totalAmountCents: booking.total_amount_cents,
      currency: booking.currency,
      deadline: booking.awaiting_action_until,
      authenticateUrl: `${view}/${AUTHENTICATE_SEGMENT}`,
    },
    notif.locale,
  );
  return { ok: true, email };
}
