import { NextRequest, NextResponse } from 'next/server';
import { getPaymentProvider } from '@/lib/payments';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('x-onvopay-signature') ?? '';

  const provider = getPaymentProvider();
  const payload = provider.verifyWebhook(rawBody, signature);
  if (!payload) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  if (payload.eventType !== 'payment.succeeded') {
    return NextResponse.json({ received: true });
  }

  const db = createSupabaseServiceClient();

  const { error: conflictError } = await db
    .from('processed_webhook_events')
    .insert({ id: payload.eventId, processed_at: new Date().toISOString() });

  if (conflictError) {
    // Already processed — idempotent 200
    return NextResponse.json({ received: true });
  }

  const bookingId = payload.metadata.bookingId;

  const { data: booking } = await db
    .from('bookings')
    .select('tickets_adult, tickets_child, tickets_student')
    .eq('id', bookingId)
    .single();

  const totalSeats = booking
    ? (booking.tickets_adult ?? 0) + (booking.tickets_child ?? 0) + (booking.tickets_student ?? 0)
    : 0;

  const { error: rpcError } = await db.rpc('confirm_booking', {
    p_booking_id: bookingId,
    p_external_payment_id: payload.paymentId,
    p_total_seats: totalSeats,
  });

  if (rpcError) {
    console.error('confirm_booking failed:', rpcError.message);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
