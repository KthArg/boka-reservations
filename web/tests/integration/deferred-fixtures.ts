import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Fixtures de las suites del cobro diferido (spec 0029, workstream B). No es un archivo de test
// (no matchea `*.test.ts`). Crean salidas, holds y reservas diferidas llamando las mismas
// funciones SQL que usa la app; el HTTP a OnvoPay no se ejercita acá.

export type Db = SupabaseClient<Database>;
export type DeferredArgs = Database['public']['Functions']['create_deferred_booking']['Args'];

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const MANDATE_CENTS = 7000;
export const MANDATE_CURRENCY = 'USD';
export const HOLD_SEATS = 2;
/** Tarjeta vencida hace años: siempre vence antes de cualquier salida futura. */
export const EXPIRED_CARD = { month: 1, year: 2020 } as const;
/** Más que la ventana de cierre automático de un intent (§5.9). */
export const PAST_CLOSURE_WINDOW_MS = 8 * DAY_MS;

export const uid = () => crypto.randomUUID().slice(0, 8);
export const isoFromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

// Tipado sobre la respuesta entera: es una unión (éxito | error) y la inferencia de `data: T`
// sobre ella colapsa a never.
export function must<R extends { data: unknown; error: { message: string } | null }>(
  result: R,
  what: string,
): NonNullable<R['data']> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? 'sin datos'}`);
  }
  return result.data as NonNullable<R['data']>;
}

/** Para escrituras sin `.select()`: falla en el setup, cerca de la causa. */
export function ok(result: { error: { message: string } | null }, what: string): void {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
}

export function msFromNow(iso: string | null): number {
  if (iso === null) throw new Error('msFromNow: timestamp nulo');
  return new Date(iso).getTime() - Date.now();
}

export async function createDeparture(
  db: Db,
  startsInMs: number,
): Promise<{ tourId: string; instanceId: string }> {
  const tour = must(
    await db
      .from('tours')
      .insert({
        slug: `diferido-${uid()}`,
        name_es: 'Tour diferido',
        name_en: 'Deferred tour',
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
      .insert({ tour_id: tour.id, day_of_week: 3, start_time: '08:00', capacity: 40 })
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

export type HoldFixture = { holdId: string; sessionToken: string; customerId: string };

/** Hold `active` con el customer que el checkout habría creado en OnvoPay. */
export async function createActiveHold(db: Db, instanceId: string): Promise<HoldFixture> {
  const sessionToken = crypto.randomUUID();
  const customerId = `cus_${uid()}`;
  const hold = must(
    await db
      .from('tour_holds')
      .insert({
        tour_instance_id: instanceId,
        session_token: sessionToken,
        held_seats: HOLD_SEATS,
        customer_external_id: customerId,
      })
      .select('id')
      .single(),
    'hold',
  );
  return { holdId: hold.id, sessionToken, customerId };
}

export function deferredArgs(
  hold: HoldFixture,
  overrides: Partial<DeferredArgs> = {},
): DeferredArgs {
  return {
    p_hold_id: hold.holdId,
    p_session_token: hold.sessionToken,
    p_customer_name: 'Turista Diferido',
    p_customer_email: `diferido-${uid()}@example.com`,
    p_locale: 'es',
    p_tickets_adult: HOLD_SEATS,
    p_tickets_child: 0,
    p_tickets_student: 0,
    p_total_amount_cents: MANDATE_CENTS,
    p_currency: MANDATE_CURRENCY,
    p_consent_version: 'test-v1',
    p_payment_method_id: `pm_${uid()}`,
    p_customer_external_id: hold.customerId,
    p_card_brand: 'visa',
    p_card_last4: '4242',
    p_card_exp_month: 12,
    p_card_exp_year: 2030,
    ...overrides,
  };
}

export async function createDeferredBooking(
  db: Db,
  instanceId: string,
  overrides: Partial<DeferredArgs> = {},
): Promise<{ bookingId: string; hold: HoldFixture }> {
  const hold = await createActiveHold(db, instanceId);
  const bookingId = must(
    await db.rpc('create_deferred_booking', deferredArgs(hold, overrides)),
    'create_deferred_booking',
  );
  return { bookingId, hold };
}

export async function readBooking(db: Db, bookingId: string) {
  return must(await db.from('bookings').select('*').eq('id', bookingId).single(), 'readBooking');
}

/** Simula que pasó la hora mínima entre intentos desde el último cobro iniciado. */
export async function elapseRetrySpacing(db: Db, bookingId: string): Promise<void> {
  ok(
    await db
      .from('bookings')
      .update({ charge_started_at: isoFromNow(-HOUR_MS - MINUTE_MS) })
      .eq('id', bookingId)
      .not('charge_started_at', 'is', null),
    'elapseRetrySpacing',
  );
}

/**
 * charge_booking_start con la tarjeta vigente de la reserva; devuelve el outcome. Simula que ya
 * pasó la hora mínima entre intentos: los tests de esa separación llaman la función directo.
 */
export async function startChargeOutcome(db: Db, bookingId: string, externalPaymentId: string) {
  await elapseRetrySpacing(db, bookingId);
  const { payment_method_id: paymentMethodId } = await readBooking(db, bookingId);
  return must(
    await db.rpc('charge_booking_start', {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_payment_method_id: paymentMethodId as string,
    }),
    'charge_booking_start',
  );
}

/** Inicia el cobro y devuelve el intent usado (uno nuevo si no se indica). */
export async function startCharge(
  db: Db,
  bookingId: string,
  externalPaymentId = `pi_${crypto.randomUUID()}`,
): Promise<string> {
  const outcome = await startChargeOutcome(db, bookingId, externalPaymentId);
  if (outcome !== 'started') throw new Error(`charge_booking_start: ${outcome}`);
  return externalPaymentId;
}

/** Rechazo del intent indicado; devuelve si la función lo registró. */
export async function failCharge(
  db: Db,
  bookingId: string,
  externalPaymentId: string,
  intentTerminal = false,
): Promise<boolean> {
  return must(
    await db.rpc('charge_attempt_failed', {
      p_booking_id: bookingId,
      p_external_payment_id: externalPaymentId,
      p_error_code: 'card_declined',
      p_intent_terminal: intentTerminal,
    }),
    'charge_attempt_failed',
  );
}

/** Reserva diferida cancelada con su pago `failed` y el intent todavía sin cerrar. */
export async function cancelledWithUnclosedIntent(
  db: Db,
  instanceId: string,
): Promise<{ bookingId: string; intent: string }> {
  const { bookingId } = await createDeferredBooking(db, instanceId);
  const intent = await startCharge(db, bookingId);
  await failCharge(db, bookingId, intent);
  must(
    await db.rpc('cancel_unpaid_booking', {
      p_booking_id: bookingId,
      p_actor_id: null,
      p_reason: 'customer_request',
    }),
    'cancel_unpaid_booking',
  );
  return { bookingId, intent };
}

/** Lleva el failed_at de los pagos de una reserva más allá de la ventana de cierre. */
export async function ageFailedPayments(db: Db, bookingId: string): Promise<void> {
  ok(
    await db
      .from('payments')
      .update({ failed_at: isoFromNow(-PAST_CLOSURE_WINDOW_MS) })
      .eq('booking_id', bookingId)
      .eq('status', 'failed'),
    'ageFailedPayments',
  );
}

export async function readHoldStatus(db: Db, holdId: string): Promise<string> {
  const hold = must(
    await db.from('tour_holds').select('status').eq('id', holdId).single(),
    'readHoldStatus',
  );
  return hold.status;
}

export async function paymentsOf(db: Db, bookingId: string) {
  return must(
    await db.from('payments').select('*').eq('booking_id', bookingId).order('created_at'),
    'paymentsOf',
  );
}

export async function notificationKinds(db: Db, bookingId: string): Promise<string[]> {
  const rows = must(
    await db.from('notifications').select('kind').eq('booking_id', bookingId),
    'notificationKinds',
  );
  return rows.map((row) => row.kind).sort();
}

export async function notificationStatus(db: Db, bookingId: string, kind: string) {
  return must(
    await db
      .from('notifications')
      .select('id, status, cancelled_reason')
      .eq('booking_id', bookingId)
      .eq('kind', kind as Database['public']['Tables']['notifications']['Row']['kind'])
      .single(),
    'notificationStatus',
  );
}

export async function auditEntries(db: Db, bookingId: string, action: string) {
  return must(
    await db
      .from('audit_logs')
      .select('actor_type, actor_id, metadata')
      .eq('entity_id', bookingId)
      .eq('action', action),
    'auditEntries',
  );
}

export async function userIdByEmail(db: Db, email: string): Promise<string> {
  return must(await db.from('users').select('id').eq('email', email).single(), 'userIdByEmail').id;
}
