import type { EmailLocale, NotificationKind } from './types.js';
import type { RenderedEmail } from './templates/booking-confirmation.js';
import { renderBookingConfirmation } from './templates/booking-confirmation.js';
import { renderReminder24h } from './templates/reminder-24h.js';

export type BookingRow = {
  id: string;
  customer_name: string;
  customer_email: string;
  tickets_adult: number;
  tickets_child: number;
  tickets_student: number;
  total_amount_cents: number;
  currency: string;
  status: string;
  tour_instance: {
    starts_at: string;
    tour: {
      name_es: string;
      name_en: string;
      meeting_point_es: string;
      meeting_point_en: string;
    };
  };
};

export function renderForKind(
  kind: NotificationKind,
  locale: EmailLocale,
  booking: BookingRow,
  appUrl: string,
): RenderedEmail {
  const tour = booking.tour_instance.tour;
  const tourName = locale === 'es' ? tour.name_es : tour.name_en;
  const meetingPoint = locale === 'es' ? tour.meeting_point_es : tour.meeting_point_en;
  const bookingUrl = `${appUrl}/${locale}/reserva/${booking.id}`;

  if (kind === 'booking_confirmation') {
    return renderBookingConfirmation(
      {
        customerName: booking.customer_name,
        tourName,
        startsAt: booking.tour_instance.starts_at,
        meetingPoint,
        ticketsAdult: booking.tickets_adult,
        ticketsChild: booking.tickets_child,
        ticketsStudent: booking.tickets_student,
        totalAmountCents: booking.total_amount_cents,
        currency: booking.currency,
        bookingUrl,
      },
      locale,
    );
  }

  return renderReminder24h(
    {
      customerName: booking.customer_name,
      tourName,
      startsAt: booking.tour_instance.starts_at,
      meetingPoint,
      bookingUrl,
    },
    locale,
  );
}
