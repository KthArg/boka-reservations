import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { createHold, releaseHold } from '@/lib/booking/availability';
import { resolveAuthoritativeCharge } from '@/lib/booking/checkout-pricing';
import { getPaymentProvider } from '@/lib/payments';
import type { TicketQuantities } from '@/lib/booking/quantities';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '@shared/constants/legal';
import { HoldStatus } from '@shared/constants/enums';

export type BookingLocale = 'es' | 'en';

export type InitCheckoutParams = {
  instanceId: string;
  sessionToken: string;
  customerName: string;
  customerEmail: string;
  quantities: TicketQuantities;
  locale: BookingLocale;
  /**
   * El llamador validó las dos aceptaciones del checkout: términos y consentimiento de datos
   * (specs 0021 y 0031). Con `true` se estampan las dos versiones; con `false`, ninguna.
   */
  legalAccepted: boolean;
};

export type InitCheckoutResult = {
  externalPaymentId: string;
  bookingId: string;
};

const CHECKOUT_CURRENCY = 'USD';

export async function initCheckout(params: InitCheckoutParams): Promise<InitCheckoutResult> {
  const {
    instanceId,
    sessionToken,
    customerName,
    customerEmail,
    quantities,
    locale,
    legalAccepted,
  } = params;

  const totalSeats = quantities.adult + quantities.child + quantities.student;
  if (totalSeats === 0) throw new Error('CHECKOUT_NO_TICKETS');

  const db = createSupabaseServiceClient();

  // Monto y descripción autoritativos: se calculan en el server desde tour_pricing,
  // ignorando cualquier dato de precio del cliente (spec 0015).
  const { tourName, totalAmountCents } = await resolveAuthoritativeCharge(
    db,
    instanceId,
    quantities,
    locale,
  );

  const { holdId } = await createHold(instanceId, totalSeats, sessionToken);

  try {
    const acceptedAt = legalAccepted ? new Date().toISOString() : null;
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
        // Evidencia de las aceptaciones (specs 0021 y 0031). El llamador ya las exigió; las
        // versiones las estampa el server, no el cliente.
        consent_at: acceptedAt,
        consent_version: legalAccepted ? PRIVACY_NOTICE_VERSION : null,
        terms_accepted_at: acceptedAt,
        terms_version: legalAccepted ? TERMS_VERSION : null,
      })
      .select('id')
      .single();

    if (bookingErr || !booking) throw new Error(bookingErr?.message ?? 'Error al crear reserva');

    const provider = getPaymentProvider();
    const session = await provider.createPaymentSession({
      amountCents: totalAmountCents,
      currency: CHECKOUT_CURRENCY,
      description: tourName,
    });

    // Chequeo obligatorio (spec 0028, A1): sin fila en `payments`, el webhook no puede
    // correlacionar el cobro y el reconciliador cancelaría como `no_payment` sin refund.
    // Si el INSERT falla: cancelar el intent best-effort (endpoint pendiente de verificar
    // en sandbox, P1 del spec; si no existe, el intent igual nunca llega al widget) y
    // abortar — el catch de abajo libera el hold de inmediato.
    const { error: paymentErr } = await db.from('payments').insert({
      booking_id: booking.id,
      external_payment_id: session.externalPaymentId,
      amount_cents: totalAmountCents,
      currency: CHECKOUT_CURRENCY,
    });
    if (paymentErr) {
      await provider.cancelPaymentSession(session.externalPaymentId).catch(() => undefined);
      throw new Error(paymentErr.message);
    }

    // Capa 1 anti-sobreventa (spec 0025): con el payment intent creado, el hold pasa de
    // `active` a `paying`. release-expired-holds (que solo toca `active`) ya no lo libera, así
    // el cupo queda reservado durante todo el ciclo de pago aunque supere el TTL de 15 min.
    // Se hace al final: si algo falla antes, el hold sigue `active` y el catch lo libera.
    const { error: holdErr } = await db
      .from('tour_holds')
      .update({ status: HoldStatus.Paying })
      .eq('id', holdId)
      .eq('status', HoldStatus.Active);
    if (holdErr) throw new Error(holdErr.message);

    return { externalPaymentId: session.externalPaymentId, bookingId: booking.id };
  } catch (err) {
    await releaseHold(holdId).catch(() => undefined);
    throw err;
  }
}
