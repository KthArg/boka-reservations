import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../web/types/database.js';

// Fixtures de las suites de los jobs del cobro diferido (spec 0029, workstream B). No es un test.
// Crean reservas diferidas con las mismas funciones SQL que usa la app; OnvoPay se simula en
// cada suite.

export type Db = SupabaseClient<Database>;

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const MANDATE_CENTS = 7000;
export const MANDATE_CURRENCY = 'USD';

export const db: Db = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const uid = () => crypto.randomUUID().slice(0, 8);

export function must<R extends { data: unknown; error: { message: string } | null }>(
  result: R,
  what: string,
): NonNullable<R['data']> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? 'sin datos'}`);
  }
  return result.data;
}

export function ok(result: { error: { message: string } | null }, what: string): void {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
}

export const isoFromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

export async function createDeparture(
  startsInMs: number,
): Promise<{ tourId: string; instanceId: string }> {
  const tour = must(
    await db
      .from('tours')
      .insert({
        slug: `worker-diferido-${uid()}`,
        name_es: 'T',
        name_en: 'T',
        description_es: 'd',
        description_en: 'd',
        difficulty: 'easy',
        duration_minutes: 60,
        meeting_point_es: 'P',
        meeting_point_en: 'P',
        includes_es: 'g',
        includes_en: 'g',
        min_participants: 4,
        max_capacity: 40,
      })
      .select('id')
      .single(),
    'tour',
  );
  const schedule = must(
    await db
      .from('tour_schedules')
      .insert({ tour_id: tour.id, day_of_week: 4, start_time: '08:00', capacity: 40 })
      .select('id')
      .single(),
    'schedule',
  );
  const startsAt = isoFromNow(startsInMs);
  const instance = must(
    await db
      .from('tour_instances')
      .insert({
        tour_id: tour.id,
        schedule_id: schedule.id,
        starts_at: startsAt,
        ends_at: startsAt,
        capacity_total: 40,
      })
      .select('id')
      .single(),
    'instance',
  );
  return { tourId: tour.id, instanceId: instance.id };
}

export type DeferredFixture = { bookingId: string; holdId: string; customerId: string };

export async function createDeferredBooking(instanceId: string): Promise<DeferredFixture> {
  const customerId = `cus_${uid()}`;
  const sessionToken = crypto.randomUUID();
  const hold = must(
    await db
      .from('tour_holds')
      .insert({
        tour_instance_id: instanceId,
        session_token: sessionToken,
        held_seats: 1,
        customer_external_id: customerId,
      })
      .select('id')
      .single(),
    'hold',
  );
  const bookingId = must(
    await db.rpc('create_deferred_booking', {
      p_hold_id: hold.id,
      p_session_token: sessionToken,
      p_customer_name: 'Turista Worker',
      p_customer_email: `worker-${uid()}@example.com`,
      p_locale: 'es',
      p_tickets_adult: 1,
      p_tickets_child: 0,
      p_tickets_student: 0,
      p_total_amount_cents: MANDATE_CENTS,
      p_currency: MANDATE_CURRENCY,
      p_consent_version: 'test-v1',
      p_terms_version: 'test-v1',
      p_payment_method_id: `pm_${uid()}`,
      p_customer_external_id: customerId,
      p_card_brand: 'visa',
      p_card_last4: '4242',
      p_card_exp_month: 12,
      p_card_exp_year: 2030,
    }),
    'create_deferred_booking',
  );
  return { bookingId, holdId: hold.id, customerId };
}

/** Inicia un cobro; simula que ya pasó la hora mínima desde el intento anterior, si lo hubo. */
export async function startCharge(bookingId: string): Promise<string> {
  const intent = `pi_${crypto.randomUUID()}`;
  ok(
    await db
      .from('bookings')
      .update({ charge_started_at: isoFromNow(-HOUR_MS - MINUTE_MS) })
      .eq('id', bookingId)
      .not('charge_started_at', 'is', null),
    'elapse retry spacing',
  );
  const { payment_method_id: paymentMethodId } = await readBooking(bookingId);
  const outcome = must(
    await db.rpc('charge_booking_start', {
      p_booking_id: bookingId,
      p_external_payment_id: intent,
      p_payment_method_id: paymentMethodId as string,
    }),
    'charge_booking_start',
  );
  if (outcome !== 'started') throw new Error(`charge_booking_start: ${outcome}`);
  return intent;
}

/** Simula que el cobro se inició hace más que el umbral del watchdog. */
export async function backdateCharge(bookingId: string, agoMs: number): Promise<void> {
  ok(
    await db
      .from('bookings')
      .update({ charge_started_at: isoFromNow(-agoMs) })
      .eq('id', bookingId),
    'backdateCharge',
  );
}

export async function readBooking(bookingId: string) {
  return must(await db.from('bookings').select('*').eq('id', bookingId).single(), 'readBooking');
}

/** El único pago de la reserva; falla explícito si no existe. */
export async function firstPayment(bookingId: string) {
  const [payment] = await paymentsOf(bookingId);
  if (!payment) throw new Error(`firstPayment: la reserva ${bookingId} no tiene pagos`);
  return payment;
}

export async function paymentsOf(bookingId: string) {
  return must(
    await db.from('payments').select('*').eq('booking_id', bookingId).order('created_at'),
    'paymentsOf',
  );
}

/** Rechazo registrado del intent: la reserva vuelve a pending_minimum. */
export async function recordDecline(
  bookingId: string,
  intent: string,
  intentTerminal = false,
): Promise<void> {
  ok(
    await db.rpc('charge_attempt_failed', {
      p_booking_id: bookingId,
      p_external_payment_id: intent,
      p_error_code: 'card_declined',
      p_intent_terminal: intentTerminal,
    }),
    'charge_attempt_failed',
  );
}

/** Cobro iniciado y autorizado sin capturar (spec 0033): la plata queda reservada, no cobrada. */
export async function authorizeCharge(bookingId: string): Promise<string> {
  const intent = await startCharge(bookingId);
  const recorded = must(
    await db.rpc('record_authorization', {
      p_booking_id: bookingId,
      p_external_payment_id: intent,
    }),
    'record_authorization',
  );
  if (!recorded) throw new Error('record_authorization devolvió false');
  return intent;
}

export async function cancelByTourist(bookingId: string): Promise<void> {
  const outcome = must(
    await db.rpc('cancel_unpaid_booking', {
      p_booking_id: bookingId,
      p_actor_id: null,
      p_reason: 'customer_request',
    }),
    'cancel_unpaid_booking',
  );
  if (outcome !== 'cancelled') throw new Error(`cancel_unpaid_booking: ${outcome}`);
}

export async function updateBooking(
  bookingId: string,
  changes: Database['public']['Tables']['bookings']['Update'],
): Promise<void> {
  ok(await db.from('bookings').update(changes).eq('id', bookingId), 'updateBooking');
}

export async function startDepartureNow(instanceId: string): Promise<void> {
  ok(
    await db
      .from('tour_instances')
      .update({ starts_at: isoFromNow(-MINUTE_MS) })
      .eq('id', instanceId),
    'startDepartureNow',
  );
}

export async function auditOf(entityId: string, action: string) {
  return must(
    await db
      .from('audit_logs')
      .select('actor_type, metadata')
      .eq('entity_id', entityId)
      .eq('action', action),
    'auditOf',
  );
}

export async function refundsOf(bookingId: string) {
  return must(
    await db.from('refunds').select('amount_cents, reason').eq('booking_id', bookingId),
    'refundsOf',
  );
}

export async function deleteWebhookEvents(ids: string[]): Promise<void> {
  if (ids.length > 0) await db.from('processed_webhook_events').delete().in('id', ids);
}

/** Borra los tours de la suite y toda su descendencia, en orden de FK. */
export async function deleteDepartures(tourIds: string[]): Promise<void> {
  if (tourIds.length === 0) return;
  const instances = must(
    await db.from('tour_instances').select('id').in('tour_id', tourIds),
    'instances',
  ).map((row) => row.id);
  if (instances.length > 0) {
    const bookings = must(
      await db.from('bookings').select('id').in('tour_instance_id', instances),
      'bookings',
    ).map((row) => row.id);
    if (bookings.length > 0) {
      await db.from('notifications').delete().in('booking_id', bookings);
      await db.from('refunds').delete().in('booking_id', bookings);
      await db.from('payments').delete().in('booking_id', bookings);
      await db.from('booking_access_tokens').delete().in('booking_id', bookings);
    }
    await db.from('bookings').delete().in('tour_instance_id', instances);
    await db.from('tour_holds').delete().in('tour_instance_id', instances);
  }
  await db.from('tour_instances').delete().in('tour_id', tourIds);
  await db.from('tour_schedules').delete().in('tour_id', tourIds);
  await db.from('tours').delete().in('id', tourIds);
}
