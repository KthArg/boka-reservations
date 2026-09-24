// Emails del cobro diferido (spec 0029 §5.7, §5.8, §9) — send-notifications contra DB y Mailpit
// reales. Cada aviso sale solo en su estado y sus enlaces vencen con el plazo del aviso.
// Requiere: supabase start (Mailpit en 54324) + seed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendNotifications } from '../../src/jobs/send-notifications.js';
import {
  cancelByTourist,
  createDeferredBooking,
  createDeparture,
  DAY_MS,
  db,
  deleteDepartures,
  isoFromNow,
  MINUTE_MS,
  must,
  ok,
  readBooking,
  recordDecline,
  startCharge,
  updateBooking,
} from './deferred-fixtures.js';

const MAILPIT_API = 'http://127.0.0.1:54324/api/v1';

type MailpitSummary = { ID: string; Subject: string; To: { Address: string }[] };

let departure: { tourId: string; instanceId: string };

async function mailTo(address: string): Promise<{ subject: string; text: string }[]> {
  const res = await fetch(`${MAILPIT_API}/messages`);
  const { messages } = (await res.json()) as { messages: MailpitSummary[] | null };
  const mine = (messages ?? []).filter((m) => m.To.some((to) => to.Address === address));
  return Promise.all(
    mine.map(async (m) => {
      const detail = await fetch(`${MAILPIT_API}/message/${m.ID}`);
      const body = (await detail.json()) as { Text: string };
      return { subject: m.Subject, text: body.Text };
    }),
  );
}

async function notification(bookingId: string, kind: string) {
  return must(
    await db
      .from('notifications')
      .select('status, cancelled_reason, scheduled_for')
      .eq('booking_id', bookingId)
      .eq('kind', kind as 'booking_reserved')
      .single(),
    'notification',
  );
}

async function tokenExpiries(bookingId: string): Promise<number[]> {
  const rows = must(
    await db.from('booking_access_tokens').select('expires_at').eq('booking_id', bookingId),
    'tokens',
  );
  return rows.map((row) => new Date(row.expires_at).getTime());
}

beforeEach(async () => {
  await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' }).catch(() => undefined);
  departure = await createDeparture(10 * DAY_MS);
});

afterEach(async () => {
  await deleteDepartures([departure.tourId]);
});

describe('send-notifications — avisos del cobro diferido', () => {
  it('sends the reservation email with the amount and the card last 4', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    const { customer_email: email } = await readBooking(bookingId);

    // Act
    await sendNotifications();

    // Assert
    const [message] = await mailTo(email);
    expect(message?.subject).toContain('registrada');
    expect(message?.text).toContain('4242');
    expect((await notification(bookingId, 'booking_reserved')).status).toBe('sent');
  });

  it('sends the declined card notice with a card link that expires at the recovery deadline', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    await recordDecline(bookingId, await startCharge(bookingId));
    const booking = await readBooking(bookingId);

    // Act
    await sendNotifications();

    // Assert
    const declined = (await mailTo(booking.customer_email)).find((m) =>
      m.subject.includes('No pudimos cobrar'),
    );
    expect(declined?.text).toMatch(/\/booking\/[\w-]+\/card/);
    expect(await tokenExpiries(bookingId)).toContain(
      new Date(booking.recovery_deadline as string).getTime(),
    );
  });

  it('sends the 3DS link while the authentication is pending', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    const intent = await startCharge(bookingId);
    ok(
      await db.rpc('charge_requires_action', {
        p_booking_id: bookingId,
        p_external_payment_id: intent,
      }),
      '3ds',
    );
    const { customer_email: email } = await readBooking(bookingId);

    // Act
    await sendNotifications();

    // Assert
    const challenge = (await mailTo(email)).find((m) => m.subject.includes('confirmar el cobro'));
    expect(challenge?.text).toMatch(/\/booking\/[\w-]+\/authenticate/);
  });

  it('cancels a declined notice whose recovery deadline already passed', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    await recordDecline(bookingId, await startCharge(bookingId));
    await updateBooking(bookingId, { recovery_deadline: isoFromNow(-MINUTE_MS) });

    // Act
    await sendNotifications();

    // Assert
    expect(await notification(bookingId, 'charge_failed_action_required_1')).toMatchObject({
      status: 'cancelled',
      cancelled_reason: 'recovery-expired',
    });
  });

  it('tells the tourist no charge was made when an unpaid booking is cancelled', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    await cancelByTourist(bookingId);
    const { customer_email: email } = await readBooking(bookingId);

    // Act
    await sendNotifications();

    // Assert
    const cancellation = (await mailTo(email)).find((m) => m.subject.includes('cancelada'));
    expect(cancellation?.text).toContain('No se hizo ningún cobro');
  });

  // Spec 0033 §5.12: lo encola cancel_booking_for_departure. Acá se inserta la fila directo
  // porque los tipos de la DB todavía no exponen esa función; el objetivo es el envío del kind.
  it('sends the departure cancelled notice when the minimum was not reached', async () => {
    // Arrange
    const { bookingId } = await createDeferredBooking(departure.instanceId);
    const { customer_email: email } = await readBooking(bookingId);
    ok(
      await db.from('notifications').insert({
        booking_id: bookingId,
        kind: 'departure_cancelled_minimum',
        recipient_email: email,
        locale: 'es',
        scheduled_for: isoFromNow(-MINUTE_MS),
      }),
      'departure cancelled notification',
    );

    // Act
    await sendNotifications();

    // Assert
    const notice = (await mailTo(email)).find((m) => m.subject.includes('salida fue cancelada'));
    expect(notice?.text).toContain('no alcanzó el mínimo de participantes');
    expect(notice?.text).toContain('No se hizo ningún cobro');
    expect((await notification(bookingId, 'departure_cancelled_minimum')).status).toBe('sent');
  });
});
