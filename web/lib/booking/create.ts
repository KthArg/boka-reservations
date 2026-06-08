import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { createHold, releaseHold } from '@/lib/booking/availability';
import { getPaymentProvider } from '@/lib/payments';

export type TicketQuantities = {
  adult: number;
  child: number;
  student: number;
};

export type PricingRow = {
  ticket_type: 'adult' | 'child' | 'student';
  price_usd: number;
};

export type BookingLocale = 'es' | 'en';

export type InitCheckoutParams = {
  instanceId: string;
  sessionToken: string;
  customerName: string;
  customerEmail: string;
  quantities: TicketQuantities;
  pricing: PricingRow[];
  tourName: string;
  locale: BookingLocale;
};

export type InitCheckoutResult = {
  externalPaymentId: string;
  bookingId: string;
};

export function calculateTotalCents(quantities: TicketQuantities, pricing: PricingRow[]): number {
  const priceMap = new Map(pricing.map((p) => [p.ticket_type, p.price_usd]));
  const total =
    (quantities.adult * (priceMap.get('adult') ?? 0) +
      quantities.child * (priceMap.get('child') ?? 0) +
      quantities.student * (priceMap.get('student') ?? 0)) *
    100;
  return Math.round(total);
}

export async function initCheckout(params: InitCheckoutParams): Promise<InitCheckoutResult> {
  const {
    instanceId,
    sessionToken,
    customerName,
    customerEmail,
    quantities,
    pricing,
    tourName,
    locale,
  } = params;

  const totalSeats = quantities.adult + quantities.child + quantities.student;
  if (totalSeats === 0) throw new Error('CHECKOUT_NO_TICKETS');

  const totalAmountCents = calculateTotalCents(quantities, pricing);
  if (totalAmountCents === 0) throw new Error('CHECKOUT_ZERO_AMOUNT');

  const { holdId } = await createHold(instanceId, totalSeats, sessionToken);

  try {
    const db = createSupabaseServiceClient();

    const { data: booking, error: bookingErr } = await db
      .from('bookings')
      .insert({
        tour_instance_id: instanceId,
        hold_id: holdId,
        customer_name: customerName,
        customer_email: customerEmail,
        tickets_adult: quantities.adult,
        tickets_child: quantities.child,
        tickets_student: quantities.student,
        total_amount_cents: totalAmountCents,
        locale,
      })
      .select('id')
      .single();

    if (bookingErr || !booking) throw new Error(bookingErr?.message ?? 'Error al crear reserva');

    const provider = getPaymentProvider();
    const session = await provider.createPaymentSession({
      amountCents: totalAmountCents,
      currency: 'USD',
      description: tourName,
    });

    await db.from('payments').insert({
      booking_id: booking.id,
      external_payment_id: session.externalPaymentId,
      amount_cents: totalAmountCents,
      currency: 'USD',
    });

    return { externalPaymentId: session.externalPaymentId, bookingId: booking.id };
  } catch (err) {
    await releaseHold(holdId).catch(() => undefined);
    throw err;
  }
}
