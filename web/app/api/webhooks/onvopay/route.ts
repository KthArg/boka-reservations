import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { ConfirmBookingOutcome } from '@shared/constants/enums';
import { getPaymentProvider } from '@/lib/payments';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';

/** Alerta agregada a Sentry (una issue por fingerprint), con el booking afectado. */
function alert(message: string, fingerprint: string, bookingId: string, extra?: string): void {
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setFingerprint([fingerprint]);
    scope.setExtra('bookingId', bookingId);
    if (extra) scope.setExtra('detail', extra);
    Sentry.captureMessage(message);
  });
}

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

  // PAYSEC-01 (spec 0023): exigir status 'succeeded' además del eventType. No inducible sin el
  // secreto del webhook; defensa extra ante un evento 'succeeded' con un status no exitoso.
  if (payload.status !== 'succeeded') {
    return NextResponse.json({ received: true });
  }

  const db = createSupabaseServiceClient();

  // maybeSingle + chequeo de error (spec 0028): un fallo transitorio de la query NO es
  // "el pago no existe". Ante error se responde 500 para que OnvoPay reintente; el 404
  // queda solo para el caso real de intent desconocido.
  const { data: payment, error: paymentErr } = await db
    .from('payments')
    .select('booking_id, amount_cents, currency')
    .eq('external_payment_id', payload.paymentId)
    .maybeSingle();

  if (paymentErr) {
    console.error('webhook: error leyendo payments', paymentErr.message);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
  if (!payment) {
    console.error('webhook: payment not found for intent', payload.paymentId);
    return NextResponse.json({ error: 'payment_not_found' }, { status: 404 });
  }

  // Validación de monto (spec 0014): el pago es de monto fijo que armamos nosotros.
  // Si lo que OnvoPay dice que se pagó no coincide EXACTO con lo esperado, NO se
  // confirma: se marca payment_mismatch para revisión manual. Se responde 200 (no es
  // transitorio; reintentar no lo arregla). El reconciliador (0013) es la red de
  // respaldo si el flag fallara acá. La moneda se compara normalizada a mayúsculas
  // (ISO 4217 es case-insensitive) para no marcar falso-mismatch por formato.
  const currencyMismatch = payload.currency.toUpperCase() !== payment.currency.toUpperCase();
  if (payload.amountCents !== payment.amount_cents || currencyMismatch) {
    const { error: flagError } = await db.rpc('flag_payment_mismatch', {
      p_booking_id: payment.booking_id,
      p_paid_amount_cents: payload.amountCents,
      p_paid_currency: payload.currency,
      p_source: 'webhook',
    });
    if (flagError) console.error('webhook: flag_payment_mismatch failed', flagError.message);
    alert(
      '[webhook] pago con monto/moneda no coincidente',
      'webhook-payment-mismatch',
      payment.booking_id,
      flagError?.message,
    );
    return NextResponse.json({ received: true });
  }

  // La idempotencia la maneja confirm_booking en su propia transacción: el gate por
  // p_event_id (processed_webhook_events) corta reenvíos con 'already_processed', y un
  // fallo hace rollback de todo para que el retry de OnvoPay reprocese limpio.
  // Los asientos los deriva la RPC de la propia reserva (spec 0028): este handler ya no
  // lee bookings ni puede confirmar con asientos incorrectos. Monto/moneda pagados van
  // al guard de payment_mismatch interno (spec 0026, defensa en profundidad).
  const { data: outcome, error: rpcError } = await db.rpc('confirm_booking', {
    p_booking_id: payment.booking_id,
    p_external_payment_id: payload.paymentId,
    p_event_id: payload.eventId,
    p_paid_amount_cents: payload.amountCents,
    p_paid_currency: payload.currency,
  });

  if (rpcError) {
    console.error('confirm_booking failed:', rpcError.message);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // Alertas según el outcome (spec 0028; reemplaza la re-lectura del status previa).
  if (outcome === ConfirmBookingOutcome.OverbookedRefunded) {
    alert(
      '[webhook] cupo agotado al confirmar: reserva auto-reembolsada',
      'booking-overbooked-refunded',
      payment.booking_id,
    );
  } else if (outcome === ConfirmBookingOutcome.LatePaymentRefunded) {
    // Pago tardío sobre una reserva cancelada (p. ej. staleness): la RPC ya encoló el
    // refund total. Se alerta para que el operador sepa que hubo un cobro sin reserva.
    alert(
      '[webhook] pago tardío sobre reserva cancelada: refund total encolado',
      'webhook-late-payment-refunded',
      payment.booking_id,
    );
  } else if (outcome === ConfirmBookingOutcome.Ignored) {
    alert(
      '[webhook] pago recibido en estado no accionable: revisión manual',
      'webhook-ignored-status',
      payment.booking_id,
    );
  }

  return NextResponse.json({ received: true });
}
