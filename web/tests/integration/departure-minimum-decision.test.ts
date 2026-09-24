// Cancelación con una autorización viva y decisión del staff sobre el mínimo (spec 0033 §5.5 y
// §5.6). Prueba las funciones SQL nuevas y el módulo de la web que las orquesta con la pasarela
// simulada. Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';
import { AuditActorType } from '@shared/constants/audit';
import { CancellationError, UnpaidCancelReason } from '@shared/constants/cancellations';
import { DepartureDecision } from '@shared/constants/departures';
import type { PaymentProvider } from '@/lib/payments';
import { deleteToursDeep } from './cleanup';
import {
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  MANDATE_CENTS,
  MANDATE_CURRENCY,
  must,
  notificationKinds,
  ok,
  readBooking,
  readHoldStatus,
  startCharge,
  userIdByEmail,
  type Db,
} from './deferred-fixtures';

// decideDeparture exige rol de panel y revalida rutas; fuera de un request de Next se mockean.
const panelUser = { id: '', userRole: 'staff' };
vi.mock('@/lib/auth/server', () => ({
  requireAnyRole: vi.fn(async () => panelUser),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { cancelUnpaidBooking } = await import('@/lib/booking/cancel-unpaid');
const { decideDeparture } = await import('@/lib/departures/decision-action');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tourIds: string[] = [];
const eventIds: string[] = [];
const cancelledIntents: string[] = [];
let instanceId: string;

/** Pasarela simulada: registra lo que se suelta y, si se le pide, falla el POST /cancel. */
function fakeProvider(fails = false): PaymentProvider {
  return {
    cancelPaymentSession: async (id: string) => {
      if (fails) throw new Error('onvopay cancel 500');
      cancelledIntents.push(id);
    },
  } as unknown as PaymentProvider;
}

/** Reserva con la plata retenida y no cobrada, como la deja el motor del mínimo. */
async function authorized(): Promise<{ bookingId: string; holdId: string; intent: string }> {
  const { bookingId, hold } = await createDeferredBooking(db, instanceId);
  const intent = await startCharge(db, bookingId);
  const recorded = must(
    await db.rpc('record_authorization', {
      p_booking_id: bookingId,
      p_external_payment_id: intent,
    }),
    'record_authorization',
  );
  expect(recorded).toBe(true);
  return { bookingId, holdId: hold.holdId, intent };
}

async function openCycle(): Promise<void> {
  const outcome = must(
    await db.rpc('open_departure_charge', { p_instance_id: instanceId }),
    'open_departure_charge',
  );
  expect(outcome).toBe('opened');
}

const cancelByTourist = (bookingId: string, provider: PaymentProvider) =>
  cancelUnpaidBooking(db, bookingId, AuditActorType.Tourist, null, provider);

beforeEach(async () => {
  cancelledIntents.length = 0;
  const departure = await createDeparture(db, 10 * DAY_MS);
  tourIds.push(departure.tourId);
  instanceId = departure.instanceId;
  // Cobro por plazo y con un plazo largo: el ciclo está en su momento sin depender de cuánta
  // gente haya reservado, que es lo que estas pruebas no quieren simular.
  ok(
    await db
      .from('tours')
      .update({ charge_timing: 'before_departure', charge_lead_hours: 720 })
      .eq('id', departure.tourId),
    'charge timing',
  );
  panelUser.id = await userIdByEmail(db, 'staff@bokatrails.com');
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
  for (const id of eventIds) await db.from('processed_webhook_events').delete().eq('id', id);
});

describe('cancelación con una autorización viva', () => {
  it('releases the hold at the provider and cancels the booking', async () => {
    // Arrange
    const { bookingId, holdId, intent } = await authorized();

    // Act
    const result = await cancelByTourist(bookingId, fakeProvider());

    // Assert
    expect(result.ok).toBe(true);
    expect(cancelledIntents).toEqual([intent]);
    const booking = await readBooking(db, bookingId);
    expect(booking.status).toBe('cancelled');
    expect(booking.authorized_at).toBeNull();
    expect(booking.cancel_claimed_at).toBeNull();
    expect(await readHoldStatus(db, holdId)).toBe('released');
    expect(await notificationKinds(db, bookingId)).toContain('cancellation_confirmation');
  });

  // Cancelar en la base sin haber soltado la retención dejaría plata retenida sin reserva que la
  // explique: no se cancela, se libera la marca y el turista puede reintentar.
  it('leaves the booking untouched when the provider refuses to release the hold', async () => {
    // Arrange
    const { bookingId } = await authorized();

    // Act
    const result = await cancelByTourist(bookingId, fakeProvider(true));

    // Assert
    expect(result).toEqual({ ok: false, error: CancellationError.WriteFailed });
    const booking = await readBooking(db, bookingId);
    expect(booking.status).toBe('pending_payment');
    expect(booking.cancel_claimed_at).toBeNull();
    expect(booking.authorized_at).not.toBeNull();
  });

  // La marca de captura es lo que excluye al turista mientras el worker habla con la pasarela.
  it('refuses to cancel while the worker is capturing that same booking', async () => {
    // Arrange
    const { bookingId } = await authorized();
    ok(
      await db
        .from('bookings')
        .update({ capture_started_at: new Date().toISOString() })
        .eq('id', bookingId),
      'capture mark',
    );

    // Act
    const result = await cancelByTourist(bookingId, fakeProvider());

    // Assert
    expect(result).toEqual({ ok: false, error: CancellationError.ChargeInFlight });
    expect(cancelledIntents).toEqual([]);
    expect((await readBooking(db, bookingId)).status).toBe('pending_payment');
  });

  it('falls back to the usual path when the booking has no live authorization', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);

    // Act
    const result = await cancelByTourist(bookingId, fakeProvider());

    // Assert
    expect(result.ok).toBe(true);
    expect(cancelledIntents).toEqual([]);
    expect((await readBooking(db, bookingId)).status).toBe('cancelled');
  });

  it('never cancels an authorized booking that was not claimed first', async () => {
    // Arrange
    const { bookingId } = await authorized();

    // Act
    const outcome = must(
      await db.rpc('cancel_authorized_booking', {
        p_booking_id: bookingId,
        p_actor_id: null,
        p_reason: UnpaidCancelReason.CustomerRequest,
      }),
      'cancel_authorized_booking',
    );

    // Assert
    expect(outcome).toBe('not_claimed');
    expect((await readBooking(db, bookingId)).status).toBe('pending_payment');
  });
});

describe('decisión del staff sobre el mínimo', () => {
  it('confirms a departure and leaves it to the charge cycle', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    await openCycle();

    // Act
    const result = await decideDeparture(instanceId, DepartureDecision.Confirm);

    // Assert
    expect(result).toEqual({ ok: true });
    const instance = must(
      await db.from('tour_instances').select('*').eq('id', instanceId).single(),
      'instance',
    );
    expect(instance.minimum_resolution).toBe('staff_confirmed');
    expect(instance.minimum_resolved_by).toBe(panelUser.id);
    expect(instance.status).not.toBe('cancelled');
    // Confirmar no cobra: lo hace el worker en la corrida siguiente.
    expect((await readBooking(db, bookingId)).status).toBe('pending_minimum');
  });

  it('cancels a departure, its bookings and the departure itself', async () => {
    // Arrange
    const { bookingId, hold } = await createDeferredBooking(db, instanceId);
    await openCycle();

    // Act
    const result = await decideDeparture(instanceId, DepartureDecision.Cancel);

    // Assert
    expect(result).toEqual({ ok: true });
    const instance = must(
      await db.from('tour_instances').select('*').eq('id', instanceId).single(),
      'instance',
    );
    expect(instance.minimum_resolution).toBe('staff_cancelled');
    expect(instance.status).toBe('cancelled');
    expect((await readBooking(db, bookingId)).status).toBe('cancelled');
    expect(await readHoldStatus(db, hold.holdId)).toBe('released');
    // Un solo aviso por la misma cancelación (§5.5).
    const kinds = await notificationKinds(db, bookingId);
    expect(kinds).toContain('departure_cancelled_minimum');
    expect(kinds).not.toContain('cancellation_confirmation');
  });

  // El reembolso del 100 % pasa por la sobrecarga de 6 parámetros de cancel_booking (…046), que
  // aborta la transacción entera si el contrato no se cumple exacto: motivo del operador,
  // comisión 0 y monto igual al total.
  it('refunds every charged booking in full when the staff cancels', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(db, instanceId);
    const intent = await startCharge(db, bookingId);
    const confirmed = must(
      await db.rpc('confirm_booking', {
        p_booking_id: bookingId,
        p_external_payment_id: intent,
        p_event_id: intent,
        p_paid_amount_cents: MANDATE_CENTS,
        p_paid_currency: MANDATE_CURRENCY,
      }),
      'confirm_booking',
    );
    expect(confirmed).toBe('confirmed');
    eventIds.push(intent);
    await openCycle();

    // Act
    const result = await decideDeparture(instanceId, DepartureDecision.Cancel);

    // Assert
    expect(result).toEqual({ ok: true });
    const refund = must(
      await db
        .from('refunds')
        .select('amount_cents, processing_fee_cents')
        .eq('booking_id', bookingId)
        .single(),
      'refund',
    );
    expect(refund.amount_cents).toBe(MANDATE_CENTS);
    expect(refund.processing_fee_cents).toBe(0);
    expect((await readBooking(db, bookingId)).status).toBe('cancelled');
    // El aviso de la salida cancelada no se le manda a quien ya recibió el de su reembolso.
    const kinds = await notificationKinds(db, bookingId);
    expect(kinds).toContain('cancellation_confirmation');
    expect(kinds).not.toContain('departure_cancelled_minimum');
  });

  // El worker está hablando con la pasarela por esa reserva: resolver ahora podría cancelarla con
  // la plata ya cobrada.
  it('refuses to resolve while a capture is in progress', async () => {
    // Arrange
    const { bookingId } = await authorized();
    await openCycle();
    ok(
      await db
        .from('bookings')
        .update({ capture_started_at: new Date().toISOString() })
        .eq('id', bookingId),
      'capture mark',
    );

    // Act
    const result = await decideDeparture(instanceId, DepartureDecision.Cancel);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: 'departure_decision_capture_in_progress',
    });
    expect((await readBooking(db, bookingId)).status).toBe('pending_payment');
  });

  // Una server action es un endpoint POST: el tipo del argumento no existe en runtime.
  it('rejects a decision that is not one of the two allowed', async () => {
    // Arrange
    await openCycle();

    // Act
    const result = await decideDeparture(instanceId, 'destroy' as never);

    // Assert
    expect(result).toEqual({ ok: false, error: 'departure_decision_not_resolvable' });
    const instance = must(
      await db.from('tour_instances').select('minimum_resolved_at').eq('id', instanceId).single(),
      'instance',
    );
    expect(instance.minimum_resolved_at).toBeNull();
  });

  it('reports a departure that somebody else already resolved', async () => {
    // Arrange
    await openCycle();
    await decideDeparture(instanceId, DepartureDecision.Confirm);

    // Act
    const result = await decideDeparture(instanceId, DepartureDecision.Cancel);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: 'departure_decision_already_resolved',
    });
  });
});
