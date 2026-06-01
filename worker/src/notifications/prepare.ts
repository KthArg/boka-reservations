import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationRow } from './repository.js';
import type { PreparedEmail } from './types.js';
import { loadBookingForNotification } from './repository.js';
import { loadGuideAssignment } from './guide-repository.js';
import { issueGuideToken } from './guide-token.js';
import { renderForKind } from './render.js';
import { renderGuideAssignment } from './templates/guide-assignment.js';

const CONFIRMED_STATUS = 'confirmed';
const GUIDE_PATH_SEGMENT = 'guide';
const GUIDE_UPCOMING_SEGMENT = 'upcoming-tours';
const MS_PER_HOUR = 60 * 60 * 1000;
const STALE_AFTER_MS = MS_PER_HOUR;

function isStale(startsAt: string): boolean {
  return Date.now() - new Date(startsAt).getTime() > STALE_AFTER_MS;
}

/** Resuelve el email de una notificación de booking (confirmación / recordatorio). */
export async function prepareBookingEmail(
  db: SupabaseClient,
  notif: NotificationRow,
  appUrl: string,
): Promise<PreparedEmail> {
  if (!notif.booking_id) return { ok: false, reason: 'booking-missing' };

  const booking = await loadBookingForNotification(db, notif.booking_id);
  if (!booking) return { ok: false, reason: 'booking-not-found' };
  if (booking.status !== CONFIRMED_STATUS) {
    return { ok: false, reason: `booking-status-${booking.status}` };
  }
  if (isStale(booking.tour_instance.starts_at)) return { ok: false, reason: 'stale' };

  return { ok: true, email: renderForKind(notif.kind, notif.locale, booking, appUrl) };
}

/** Resuelve el email de asignación al guía: genera el token y arma el enlace. */
export async function prepareGuideEmail(
  db: SupabaseClient,
  notif: NotificationRow,
  appUrl: string,
): Promise<PreparedEmail> {
  const data = await loadGuideAssignment(db, notif);
  if (!data) return { ok: false, reason: 'assignment-not-found' };

  const token = await issueGuideToken(db, notif.guide_id as string);
  const upcomingUrl = `${appUrl}/${notif.locale}/${GUIDE_PATH_SEGMENT}/${token}/${GUIDE_UPCOMING_SEGMENT}`;
  const tourName = notif.locale === 'es' ? data.tourNameEs : data.tourNameEn;
  const meetingPoint = notif.locale === 'es' ? data.meetingPointEs : data.meetingPointEn;

  const email = renderGuideAssignment(
    {
      guideName: data.guideName,
      tourName,
      startsAt: data.startsAt,
      meetingPoint,
      passengerCount: data.passengerCount,
      upcomingUrl,
    },
    notif.locale,
  );
  return { ok: true, email };
}
