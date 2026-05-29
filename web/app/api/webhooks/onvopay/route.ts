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

  const { error: conflictError } = await db
    .from('processed_webhook_events')
    .insert({ id: payload.eventId, processed_at: new Date().toISOString() });

  if (conflictError) {
    // 23505 = unique_violation: evento ya procesado, responder 200 idempotente
    if (conflictError.code !== '23505') {
      console.error('webhook: idempotency insert failed:', conflictError.message);
      return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  const { data: payment } = await db
    .from('payments')
    .select('booking_id')
    .eq('external_payment_id', payload.paymentId)
    .single();

  if (!payment) {
    // El registro de idempotencia ya fue insertado. Devolver 200 para que
    // OnvoPay no reintente (los reintentos quedarían bloqueados de todas formas).
    console.error('webhook: payment not found for intent', payload.paymentId);
    return NextResponse.json({ received: true });
  }

  const { data: booking } = await db
    .from('bookings')
    .select('tickets_adult, tickets_child, tickets_student')
    .eq('id', payment.booking_id)
    .single();

  const totalSeats = booking
    ? (booking.tickets_adult ?? 0) + (booking.tickets_child ?? 0) + (booking.tickets_student ?? 0)
    : 0;

  const { error: rpcError } = await db.rpc('confirm_booking', {
    p_booking_id: payment.booking_id,
    p_external_payment_id: payload.paymentId,
    p_total_seats: totalSeats,
  });

  if (rpcError) {
    console.error('confirm_booking failed:', rpcError.message);
    // Eliminar el registro de idempotencia para que OnvoPay pueda reintentar.
    // Si este delete también falla, el evento queda irrecuperable — escenario
    // de fallo doble de DB que no vale la pena manejar en MVP.
    await db.from('processed_webhook_events').delete().eq('id', payload.eventId);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
