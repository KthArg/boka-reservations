import { NextRequest, NextResponse } from 'next/server';
import { getPaymentProvider } from '@/lib/payments';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('x-webhook-secret') ?? '';

  const provider = getPaymentProvider();
  const payload = provider.verifyWebhook(rawBody, signature);
  if (!payload) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  if (payload.eventType !== 'payment-intent.succeeded') {
    return NextResponse.json({ received: true });
  }

  const db = createSupabaseServiceClient();

  const { data: payment } = await db
    .from('payments')
    .select('booking_id')
    .eq('external_payment_id', payload.paymentId)
    .single();

  if (!payment) {
    console.error('webhook: payment not found for intent', payload.paymentId);
    return NextResponse.json({ error: 'payment_not_found' }, { status: 404 });
  }

  const { data: booking } = await db
    .from('bookings')
    .select('tickets_adult, tickets_child, tickets_student')
    .eq('id', payment.booking_id)
    .single();

  const totalSeats = booking
    ? (booking.tickets_adult ?? 0) + (booking.tickets_child ?? 0) + (booking.tickets_student ?? 0)
    : 0;

  // La idempotencia la maneja confirm_booking en su propia transacción: registra
  // el evento (p_event_id) en processed_webhook_events junto con la confirmación,
  // así un fallo hace rollback de ambos y el retry de OnvoPay reprocesa limpio.
  // confirm_booking es idempotente a nivel reserva (no reconfirma) y a nivel
  // evento (ON CONFLICT), así que reenviar el mismo webhook es inocuo.
  const { error: rpcError } = await db.rpc('confirm_booking', {
    p_booking_id: payment.booking_id,
    p_external_payment_id: payload.paymentId,
    p_total_seats: totalSeats,
    p_event_id: payload.eventId,
  });

  if (rpcError) {
    console.error('confirm_booking failed:', rpcError.message);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
