import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CancellationError, CancellationReason } from '@shared/constants/cancellations';
import { NotificationKind, NotificationStatus } from '@shared/constants/notifications';
import { RefundStatus } from '@shared/constants/refunds';
import { BookingStatus } from '@shared/constants/enums';
import { AuditAction } from '@shared/constants/audit';
import { bookingStatus, cleanupSeeds, reservedSeats, seed } from './cancellation-fixtures';

// server-only no resuelve en vitest; las Server Actions lo importan vía cancel.ts.
vi.mock('server-only', () => ({}));
const requireAnyRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/server', () => ({ requireAnyRole: requireAnyRoleMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { cancelByStaff, cancelByToken } = await import('@/lib/booking/cancel-action');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let admin: SupabaseClient;
let staffUserId: string;

describe('cancellation flow (server actions, integration)', () => {
  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await admin.from('users').select('id').eq('role', 'staff').limit(1).single();
    staffUserId = data!.id;
  });

  afterEach(async () => {
    requireAnyRoleMock.mockReset();
    await cleanupSeeds(admin);
  });

  it('cancela con reembolso (>24h): libera cupo, cancela recordatorio, encola email y refund', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId, userRole: 'staff' });
    const { bookingId, instanceId } = await seed(admin, { hoursAhead: 48, reserved: 3 });

    const result = await cancelByStaff(bookingId, CancellationReason.CustomerRequest);

    expect(result).toEqual({
      ok: true,
      refund: { eligible: true, amountCents: 9000, feeCents: 0 },
    });
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Cancelled);
    expect(await reservedSeats(admin, instanceId)).toBe(0); // 3 reservados - 3 tickets

    const { data: reminder } = await admin
      .from('notifications')
      .select('status')
      .eq('booking_id', bookingId)
      .eq('kind', NotificationKind.Reminder24h)
      .single();
    expect(reminder!.status).toBe(NotificationStatus.Cancelled);

    const { data: cxlEmail } = await admin
      .from('notifications')
      .select('status')
      .eq('booking_id', bookingId)
      .eq('kind', NotificationKind.CancellationConfirmation)
      .single();
    expect(cxlEmail!.status).toBe(NotificationStatus.Pending);

    const { data: refund } = await admin
      .from('refunds')
      .select('status, amount_cents')
      .eq('booking_id', bookingId)
      .single();
    expect(refund).toEqual({ status: RefundStatus.Pending, amount_cents: 9000 });

    const { data: audits } = await admin
      .from('audit_logs')
      .select('action')
      .eq('entity_id', bookingId);
    const actions = (audits ?? []).map((a) => a.action);
    expect(actions).toContain(AuditAction.BookingCancelled);
    expect(actions).toContain(AuditAction.RefundRequested);
  });

  it('refunda el monto efectivamente pagado, no el total de la reserva', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId, userRole: 'staff' });
    // Total 9000 pero solo se cobraron 8000: el refund debe ser por lo pagado.
    const { bookingId } = await seed(admin, { hoursAhead: 48, paymentAmountCents: 8000 });

    await cancelByStaff(bookingId, CancellationReason.CustomerRequest);

    const { data: refund } = await admin
      .from('refunds')
      .select('amount_cents, currency')
      .eq('booking_id', bookingId)
      .single();
    expect(refund).toEqual({ amount_cents: 8000, currency: 'USD' });
  });

  it('audit_logs es append-only: rechaza UPDATE y DELETE', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId, userRole: 'staff' });
    const { bookingId } = await seed(admin, { hoursAhead: 48 });
    await cancelByStaff(bookingId, CancellationReason.CustomerRequest);

    const { data: row } = await admin
      .from('audit_logs')
      .select('id')
      .eq('entity_id', bookingId)
      .limit(1)
      .single();
    expect(row).not.toBeNull();

    const upd = await admin.from('audit_logs').update({ action: 'tampered' }).eq('id', row!.id);
    expect(upd.error).not.toBeNull();

    const del = await admin.from('audit_logs').delete().eq('id', row!.id);
    expect(del.error).not.toBeNull();
  });

  it('cancela sin reembolso (<24h): no crea refund pero sí encola el email', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId, userRole: 'staff' });
    const { bookingId } = await seed(admin, { hoursAhead: 12 });

    const result = await cancelByStaff(bookingId, CancellationReason.CustomerRequest);

    expect(result).toEqual({ ok: true, refund: { eligible: false, amountCents: 0, feeCents: 0 } });
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Cancelled);
    const { data: refunds } = await admin.from('refunds').select('id').eq('booking_id', bookingId);
    expect(refunds).toEqual([]);
    const { count } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .eq('kind', NotificationKind.CancellationConfirmation);
    expect(count).toBe(1);
  });

  it('es idempotente: la segunda cancelación no duplica refund', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId, userRole: 'staff' });
    const { bookingId } = await seed(admin, { hoursAhead: 48 });

    await cancelByStaff(bookingId, CancellationReason.CustomerRequest);
    const second = await cancelByStaff(bookingId, CancellationReason.CustomerRequest);

    expect(second).toEqual({ ok: false, error: CancellationError.NotCancellable });
    const { count } = await admin
      .from('refunds')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId);
    expect(count).toBe(1);
  });

  it('cancela por token válido del turista', async () => {
    const { bookingId, token } = await seed(admin, { hoursAhead: 48 });

    const result = await cancelByToken(token, {
      status: BookingStatus.Confirmed,
      refundAmountCents: 9000,
    });

    expect(result.ok).toBe(true);
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Cancelled);
  });

  it('rechaza un token inválido sin tocar la reserva', async () => {
    const { bookingId } = await seed(admin, { hoursAhead: 48 });

    const result = await cancelByToken(crypto.randomUUID());

    expect(result).toEqual({ ok: false, error: CancellationError.InvalidToken });
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Confirmed);
  });

  it('rechaza al staff sin rol', async () => {
    requireAnyRoleMock.mockRejectedValue(new Error('UNAUTHORIZED'));
    const { bookingId } = await seed(admin, { hoursAhead: 48 });

    const result = await cancelByStaff(bookingId, CancellationReason.CustomerRequest);

    expect(result).toEqual({ ok: false, error: CancellationError.Unauthorized });
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Confirmed);
  });

  it('rechaza cancelar una reserva no confirmada', async () => {
    requireAnyRoleMock.mockResolvedValue({ id: staffUserId, userRole: 'staff' });
    const { bookingId } = await seed(admin, {
      status: BookingStatus.PendingPayment,
      withPayment: false,
    });

    const result = await cancelByStaff(bookingId, CancellationReason.CustomerRequest);

    expect(result).toEqual({ ok: false, error: CancellationError.NotCancellable });
  });
});
