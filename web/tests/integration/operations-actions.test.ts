// Acciones del panel del spec 0035: permisos, validación con Zod y traducción de los resultados
// de las funciones SQL a errores del panel. Se mockean solo las fronteras de Next.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingStatus } from '@shared/constants/enums';
import {
  DepartureCancellationReason,
  OperationError,
  ReviewDecision,
} from '@shared/constants/operations';
import { RefundStatus, TransferChannel } from '@shared/constants/refunds';
import type { Database } from '@/types/database';
import { deleteToursDeep } from './cleanup';
import { DAY_MS, HOUR_MS, readBooking, userIdByEmail, type Db } from './deferred-fixtures';
import {
  createInstance,
  createPaidBooking,
  createTour,
  readInstance,
  refundsOf,
} from './operations-fixtures';

const auth = vi.hoisted(() => ({ user: null as { id: string; userRole: string } | null }));
vi.mock('@/lib/auth/server', () => ({
  requireAnyRole: vi.fn(async () => {
    if (!auth.user) throw new Error('UNAUTHORIZED');
    return auth.user;
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { cancelDepartureAction, keepDepartureAction } =
  await import('@/lib/operations/departure-actions');
const { decideReviewAction, rescheduleBookingAction } =
  await import('@/lib/operations/booking-actions');
const { requestTransferAction, settleTransferAction } =
  await import('@/lib/operations/transfer-actions');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const db: Db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tourIds: string[] = [];
let staffId: string;

async function departure(startsInMs = 3 * DAY_MS, minimum = 4) {
  const tour = await createTour(db, minimum);
  tourIds.push(tour.tourId);
  const instanceId = await createInstance(db, tour, startsInMs);
  return { tour, instanceId };
}

beforeAll(async () => {
  staffId = await userIdByEmail(db, 'staff@bokatrails.com');
});

beforeEach(() => {
  auth.user = { id: staffId, userRole: 'staff' };
});

afterAll(async () => {
  await deleteToursDeep(db, tourIds);
});

describe('cancelDepartureAction', () => {
  it('el staff cancela una salida por clima y la reserva queda en revisión', async () => {
    const { instanceId } = await departure();
    const bookingId = await createPaidBooking(db, instanceId);

    const result = await cancelDepartureAction(instanceId, DepartureCancellationReason.Weather);

    expect(result).toEqual({ ok: true });
    expect((await readBooking(db, bookingId)).operator_review_required_at).not.toBeNull();
  });

  it('rechaza a quien no es del panel, sin tocar la salida', async () => {
    const { instanceId } = await departure();
    auth.user = null;

    const result = await cancelDepartureAction(instanceId, DepartureCancellationReason.Other);

    expect(result).toEqual({ ok: false, error: OperationError.Unauthorized });
    expect((await readInstance(db, instanceId)).status).not.toBe('cancelled');
  });

  it('rechaza un motivo que no existe', async () => {
    const { instanceId } = await departure();

    const result = await cancelDepartureAction(instanceId, 'refund_everything');

    expect(result).toEqual({ ok: false, error: OperationError.Invalid });
  });

  it('informa que ya no se cancela por mínimo con menos de 24 h', async () => {
    const { instanceId } = await departure(12 * HOUR_MS);

    const result = await cancelDepartureAction(instanceId, DepartureCancellationReason.Minimum);

    expect(result).toEqual({ ok: false, error: OperationError.MinimumTooLate });
  });
});

describe('keepDepartureAction', () => {
  it('mantiene la salida y un segundo intento informa que ya se resolvió', async () => {
    const { instanceId } = await departure();

    const first = await keepDepartureAction(instanceId);
    const second = await keepDepartureAction(instanceId);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, error: OperationError.AlreadyDone });
  });
});

describe('decideReviewAction y rescheduleBookingAction', () => {
  it('reembolsa el 100 % de una reserva en revisión', async () => {
    const { instanceId } = await departure();
    const bookingId = await createPaidBooking(db, instanceId);
    await cancelDepartureAction(instanceId, DepartureCancellationReason.Safety);

    const result = await decideReviewAction(bookingId, ReviewDecision.Refund);

    expect(result).toEqual({ ok: true });
    expect((await readBooking(db, bookingId)).status).toBe(BookingStatus.Cancelled);
  });

  it('informa que una reserva sin revisión no se decide', async () => {
    const { instanceId } = await departure();
    const bookingId = await createPaidBooking(db, instanceId);

    const result = await decideReviewAction(bookingId, ReviewDecision.NoRefund);

    expect(result).toEqual({ ok: false, error: OperationError.NotUnderReview });
  });

  it('cambia la fecha e informa la falta de cupo', async () => {
    const { tour, instanceId } = await departure();
    const bookingId = await createPaidBooking(db, instanceId, 2);
    const roomy = await createInstance(db, tour, 5 * DAY_MS);
    const tiny = await createInstance(db, tour, 6 * DAY_MS, 1);

    const noRoom = await rescheduleBookingAction(bookingId, tiny);
    const moved = await rescheduleBookingAction(bookingId, roomy);

    expect(noRoom).toEqual({ ok: false, error: OperationError.NoCapacity });
    expect(moved).toEqual({ ok: true });
    expect((await readBooking(db, bookingId)).tour_instance_id).toBe(roomy);
  });
});

describe('transferencias', () => {
  async function failedRefund() {
    const { instanceId } = await departure();
    const bookingId = await createPaidBooking(db, instanceId);
    await cancelDepartureAction(instanceId, DepartureCancellationReason.Other);
    const refund = (await refundsOf(db, bookingId))[0]!;
    await db
      .from('refunds')
      .update({
        status: RefundStatus.Failed,
        failure_reason: 'card_declined',
        external_refund_id: `re_${crypto.randomUUID()}`,
      })
      .eq('id', refund.id);
    return { bookingId, refundId: refund.id };
  }

  function settleForm(fields: Record<string, string>): FormData {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return form;
  }

  it('pide los datos y registra la transferencia con la fecha de hoy', async () => {
    const { bookingId, refundId } = await failedRefund();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(
      new Date(),
    );

    const requested = await requestTransferAction(refundId, bookingId);
    const settled = await settleTransferAction(
      null,
      settleForm({
        refundId,
        bookingId,
        channel: TransferChannel.BankTransfer,
        reference: 'TRF-778899',
        paidOn: today,
        amount: '90.00',
        currency: 'USD',
      }),
    );

    expect(requested).toEqual({ ok: true });
    expect(settled).toEqual({ ok: true });
    expect((await readBooking(db, bookingId)).status).toBe(BookingStatus.Refunded);
  });

  it('rechaza una fecha de pago futura sin llamar a la base', async () => {
    const { bookingId, refundId } = await failedRefund();
    await requestTransferAction(refundId, bookingId);

    const result = await settleTransferAction(
      null,
      settleForm({
        refundId,
        bookingId,
        channel: TransferChannel.SinpeMovil,
        reference: 'SINPE-1',
        paidOn: '2999-01-01',
        amount: '45000',
        currency: 'CRC',
      }),
    );

    expect(result).toEqual({ ok: false, error: OperationError.Invalid });
    expect((await refundsOf(db, bookingId))[0]?.status).toBe(RefundStatus.AwaitingTransfer);
  });

  it('informa que OnvoPay todavía puede acreditar un resultado desconocido', async () => {
    const { bookingId, refundId } = await failedRefund();
    await db.from('refunds').update({ failure_reason: 'ambiguous-timeout' }).eq('id', refundId);

    const result = await requestTransferAction(refundId, bookingId);

    expect(result).toEqual({ ok: false, error: OperationError.ProviderMaySettle });
  });
});
