// Tratamiento de datos según el aviso de privacidad (spec 0036, migración …050): anonimización
// completa, purga del registro a los 5 años, token negado a un usuario desactivado, borrado y
// corrección a pedido, y la foto del tour solo desde el almacenamiento propio.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditAction } from '@shared/constants/audit';
import { BookingStatus } from '@shared/constants/enums';
import { RefundStatus } from '@shared/constants/refunds';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';
import { DAY_MS, readBooking, uid, userIdByEmail, type Db } from './deferred-fixtures';
import { createInstance, createPaidBooking, createTour } from './operations-fixtures';

const auth = vi.hoisted(() => ({ adminId: '', isAdmin: true }));
vi.mock('@/lib/auth/server', () => ({
  requireRole: vi.fn(async () => {
    if (!auth.isAdmin) throw new Error('UNAUTHORIZED');
    return { id: auth.adminId, userRole: 'admin' };
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { anonymizeCustomerByEmail, previewCustomerErasure } =
  await import('@/lib/privacy/anonymize-action');
const { correctBookingContact } = await import('@/lib/privacy/contact-action');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tourIds: string[] = [];
const YEAR_MS = 365 * DAY_MS;

async function paidBookingAt(startsInMs: number): Promise<string> {
  const tour = await createTour(db, 1);
  tourIds.push(tour.tourId);
  return createPaidBooking(db, await createInstance(db, tour, startsInMs));
}

beforeAll(async () => {
  auth.adminId = await userIdByEmail(db, 'admin@bokatrails.com');
});

beforeEach(() => {
  auth.isAdmin = true;
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

describe('anonimización a los 18 meses', () => {
  it('vacía nombre, correo, datos de tarjeta y comprobante de transferencia', async () => {
    // Arrange
    const bookingId = await paidBookingAt(-2 * YEAR_MS);
    await db
      .from('bookings')
      .update({
        card_brand: 'visa',
        card_last4: '4242',
        card_exp_month: 12,
        card_exp_year: 2030,
        customer_external_id: 'cus_1',
        payment_method_id: 'pm_1',
      })
      .eq('id', bookingId);
    // Una devolución por transferencia ya registrada, con su comprobante.
    const { data: payment } = await db
      .from('payments')
      .select('id')
      .eq('booking_id', bookingId)
      .single();
    const { data: refund } = await db
      .from('refunds')
      .insert({
        booking_id: bookingId,
        payment_id: payment!.id,
        amount_cents: 9000,
        status: RefundStatus.Succeeded,
        method: 'transfer',
        transfer_channel: 'sinpe_movil',
        transfer_reference: 'SINPE-CUENTA-8888-0000',
        transfer_requested_at: new Date().toISOString(),
        transfer_paid_at: new Date().toISOString(),
        transfer_amount_cents: 9000,
        transfer_currency: 'USD',
      })
      .select('id')
      .single();

    // Act
    await db.rpc('anonymize_bookings_past_retention', {
      p_cutoff: new Date(Date.now() - 18 * 30 * DAY_MS).toISOString(),
    });

    // Assert
    const booking = await readBooking(db, bookingId);
    expect(booking.customer_name).toBe('ANONIMIZADO');
    expect(booking.card_last4).toBeNull();
    expect(booking.card_brand).toBeNull();
    expect(booking.card_exp_month).toBeNull();
    expect(booking.card_exp_year).toBeNull();
    expect(booking.customer_external_id).toBeNull();
    expect(booking.payment_method_id).toBeNull();
    expect(booking.anonymized_at).not.toBeNull();
    const { data: after } = await db
      .from('refunds')
      .select('transfer_reference')
      .eq('id', refund!.id)
      .single();
    expect(after!.transfer_reference).toBe('ANONIMIZADO');
  });

  it('cancela los avisos pendientes en lugar de mandarlos a una dirección inválida', async () => {
    const bookingId = await paidBookingAt(-2 * YEAR_MS);

    await db.rpc('anonymize_bookings_past_retention', {
      p_cutoff: new Date(Date.now() - 18 * 30 * DAY_MS).toISOString(),
    });

    const { data } = await db
      .from('notifications')
      .select('status')
      .eq('booking_id', bookingId)
      .eq('kind', 'reminder_24h')
      .single();
    expect(data!.status).toBe('cancelled');
  });

  it('alcanza también a las reservas en payment_mismatch', async () => {
    const bookingId = await paidBookingAt(-2 * YEAR_MS);
    await db.from('payments').update({ status: 'pending' }).eq('booking_id', bookingId);
    await db.from('bookings').update({ status: BookingStatus.PaymentMismatch }).eq('id', bookingId);

    await db.rpc('anonymize_bookings_past_retention', {
      p_cutoff: new Date(Date.now() - 18 * 30 * DAY_MS).toISOString(),
    });

    expect((await readBooking(db, bookingId)).customer_email).toBe('anonimizado@anonimizado.local');
  });
});

describe('purga del registro a los 5 años', () => {
  const cutoff = () => new Date(Date.now() - 5 * YEAR_MS).toISOString();

  // El corte apenas pasado el inicio de esta reserva: no anonimiza las de otras suites ni el seed.
  async function anonymized(startsInMs: number): Promise<string> {
    const bookingId = await paidBookingAt(startsInMs);
    await db.rpc('anonymize_bookings_past_retention', {
      p_cutoff: new Date(Date.now() + startsInMs + DAY_MS).toISOString(),
    });
    return bookingId;
  }

  it('borra la reserva anonimizada de un tour de hace más de 5 años', async () => {
    const bookingId = await anonymized(-6 * YEAR_MS);

    await db.rpc('purge_financial_records', { p_cutoff: cutoff() });

    const { data } = await db.from('bookings').select('id').eq('id', bookingId);
    expect(data).toEqual([]);
  });

  it('borra también sus pagos, reembolsos y avisos, y una segunda corrida no hace nada', async () => {
    const bookingId = await anonymized(-6 * YEAR_MS);

    await db.rpc('purge_financial_records', { p_cutoff: cutoff() });
    const second = await db.rpc('purge_financial_records', { p_cutoff: cutoff() });

    for (const table of ['payments', 'refunds', 'notifications'] as const) {
      const { data } = await db.from(table).select('id').eq('booking_id', bookingId);
      expect(data).toEqual([]);
    }
    expect(second.error).toBeNull();
  });

  it('no borra una reserva vieja que todavía no se anonimizó', async () => {
    const bookingId = await paidBookingAt(-6 * YEAR_MS);

    await db.rpc('purge_financial_records', { p_cutoff: cutoff() });

    expect((await readBooking(db, bookingId)).id).toBe(bookingId);
  });

  it('conserva la de hace menos de 5 años', async () => {
    const bookingId = await anonymized(-4 * YEAR_MS);

    await db.rpc('purge_financial_records', { p_cutoff: cutoff() });

    expect((await readBooking(db, bookingId)).id).toBe(bookingId);
  });

  it('conserva una payment_mismatch sin conciliar', async () => {
    const bookingId = await anonymized(-6 * YEAR_MS);
    await db.from('bookings').update({ status: BookingStatus.PaymentMismatch }).eq('id', bookingId);

    await db.rpc('purge_financial_records', { p_cutoff: cutoff() });

    expect((await readBooking(db, bookingId)).id).toBe(bookingId);
  });

  it('conserva la que tiene un reembolso sin terminar', async () => {
    const bookingId = await anonymized(-6 * YEAR_MS);
    const { data: payment } = await db
      .from('payments')
      .select('id')
      .eq('booking_id', bookingId)
      .single();
    await db.from('refunds').insert({
      booking_id: bookingId,
      payment_id: payment!.id,
      amount_cents: 9000,
      status: RefundStatus.Failed,
    });

    await db.rpc('purge_financial_records', { p_cutoff: cutoff() });

    expect((await readBooking(db, bookingId)).id).toBe(bookingId);
  });
});

describe('usuario desactivado', () => {
  it('no obtiene token nuevo', async () => {
    const staffId = await userIdByEmail(db, 'staff@bokatrails.com');
    await db.from('users').update({ active: false }).eq('id', staffId);
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await client.auth.signInWithPassword({
      email: 'staff@bokatrails.com',
      password: 'staff1234',
    });

    await db.from('users').update({ active: true }).eq('id', staffId);
    // El rechazo es el del hook, no el de una contraseña equivocada.
    expect(error?.message).toContain('Usuario desactivado');
  });
});

describe('borrado a pedido', () => {
  it('la vista previa cuenta sin mostrar datos y el borrado anonimiza la pagada', async () => {
    // Arrange
    const bookingId = await paidBookingAt(3 * DAY_MS);
    const email = `borrar-${uid()}@example.com`;
    await db.from('bookings').update({ customer_email: email }).eq('id', bookingId);

    // Act
    const preview = await previewCustomerErasure(email.toUpperCase());
    const erased = await anonymizeCustomerByEmail(email);

    // Assert
    expect(preview).toEqual({
      ok: true,
      preview: { total: 1, byStatus: { confirmed: 1 }, upcoming: 1, pendingRefunds: 0 },
    });
    expect(erased).toEqual({
      ok: true,
      result: { anonymizedCount: 1, deletedCount: 0, retainedCount: 0 },
    });
    expect((await readBooking(db, bookingId)).customer_name).toBe('ANONIMIZADO');
  });

  it('la vista previa compara el correo literal: un _ no es comodín', async () => {
    const bookingId = await paidBookingAt(3 * DAY_MS);
    const tag = uid();
    await db
      .from('bookings')
      .update({ customer_email: `ax${tag}@example.com` })
      .eq('id', bookingId);

    const preview = await previewCustomerErasure(`a_${tag}@example.com`);

    expect(preview).toEqual({
      ok: true,
      preview: { total: 0, byStatus: {}, upcoming: 0, pendingRefunds: 0 },
    });
  });

  it('no borra nada si hay un reembolso sin terminar', async () => {
    const bookingId = await paidBookingAt(3 * DAY_MS);
    const email = `pendiente-${uid()}@example.com`;
    await db.from('bookings').update({ customer_email: email }).eq('id', bookingId);
    const { data: payment } = await db
      .from('payments')
      .select('id')
      .eq('booking_id', bookingId)
      .single();
    await db.from('refunds').insert({
      booking_id: bookingId,
      payment_id: payment!.id,
      amount_cents: 9000,
      status: RefundStatus.Pending,
    });

    const result = await anonymizeCustomerByEmail(email);

    expect(result).toEqual({ ok: false, error: 'pending-refund' });
    expect((await readBooking(db, bookingId)).customer_email).toBe(email);
  });

  it('rechaza al staff y un correo inválido', async () => {
    expect(await previewCustomerErasure('no-es-correo')).toEqual({
      ok: false,
      error: 'invalid-email',
    });
    auth.isAdmin = false;
    expect(await anonymizeCustomerByEmail('alguien@example.com')).toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });
});

describe('corrección de contacto', () => {
  function form(bookingId: string, name: string, email: string): FormData {
    const data = new FormData();
    data.append('bookingId', bookingId);
    data.append('name', name);
    data.append('email', email);
    return data;
  }

  it('corrige nombre y correo, mueve los avisos pendientes y audita los dos valores', async () => {
    const bookingId = await paidBookingAt(3 * DAY_MS);
    const before = await readBooking(db, bookingId);

    const result = await correctBookingContact(
      null,
      form(bookingId, 'Ana Pérez', 'ana@example.com'),
    );

    expect(result).toEqual({ ok: true });
    const after = await readBooking(db, bookingId);
    expect(after.customer_name).toBe('Ana Pérez');
    expect(after.customer_email).toBe('ana@example.com');
    const { data: reminder } = await db
      .from('notifications')
      .select('recipient_email')
      .eq('booking_id', bookingId)
      .eq('kind', 'reminder_24h')
      .single();
    expect(reminder!.recipient_email).toBe('ana@example.com');
    const { data: logs } = await db
      .from('audit_logs')
      .select('metadata')
      .eq('entity_id', bookingId)
      .eq('action', AuditAction.BookingContactCorrected);
    // El audit guarda qué cambió, nunca el nombre ni el correo (no se anonimiza ni se purga).
    expect(logs![0]!.metadata).toEqual({ fields: ['name', 'email'] });
    expect(JSON.stringify(logs![0]!.metadata)).not.toContain(before.customer_email);
  });

  it('no corrige una reserva ya anonimizada', async () => {
    const bookingId = await paidBookingAt(3 * DAY_MS);
    await db
      .from('bookings')
      .update({ anonymized_at: new Date().toISOString() })
      .eq('id', bookingId);

    const result = await correctBookingContact(null, form(bookingId, 'Ana', 'ana@example.com'));

    expect(result).toEqual({ ok: false, error: 'not-found' });
  });

  it('rechaza un correo inválido y al staff', async () => {
    const bookingId = await paidBookingAt(3 * DAY_MS);

    const invalid = await correctBookingContact(null, form(bookingId, 'Ana', 'no-es-correo'));
    auth.isAdmin = false;
    const staff = await correctBookingContact(null, form(bookingId, 'Ana', 'ana@example.com'));

    expect(invalid).toEqual({ ok: false, error: 'invalid' });
    expect(staff).toEqual({ ok: false, error: 'unauthorized' });
  });
});

describe('foto del tour', () => {
  it('la base rechaza una URL que no es del almacenamiento propio', async () => {
    const tour = await createTour(db, 1);
    tourIds.push(tour.tourId);

    const outside = await db
      .from('tours')
      .update({ cover_image_url: 'https://images.example.com/volcan.jpg' })
      .eq('id', tour.tourId);
    const own = await db
      .from('tours')
      .update({ cover_image_url: `${SUPABASE_URL}/storage/v1/object/public/tour-images/a.webp` })
      .eq('id', tour.tourId);

    expect(outside.error?.message).toContain('tours_cover_image_url_check');
    expect(own.error).toBeNull();
  });
});
