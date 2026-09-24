// cancelBooking y la vista de la reserva (spec 0032) con la base mockeada: la carrera entre dos
// cancelaciones y un error de configuración de la comisión.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  CancelBookingOutcome,
  CancellationError,
  CancellationReason,
} from '@shared/constants/cancellations';
import { AuditActorType } from '@shared/constants/audit';

const alert = vi.hoisted(() => vi.fn());
vi.mock('./sentry-alert', () => ({ captureAlert: alert }));
vi.mock('./cancel-unpaid', () => ({ cancelUnpaidBooking: vi.fn() }));
// Política activa con un corte de la suite (se despliega inactiva).
vi.mock('@shared/constants/policies', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@shared/constants/policies')>();
  return {
    ...mod,
    computeRefund: (input: Parameters<typeof mod.computeRefund>[0]) =>
      mod.computeRefund({ feeFromTermsVersion: '2026-10-01', ...input }),
  };
});

const { cancelBooking, getBookingView } = await import('./cancel');

const NOW = new Date('2026-11-01T12:00:00.000Z');
const IN_TWO_DAYS = new Date(NOW.getTime() + 48 * 60 * 60 * 1000).toISOString();

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    customer_name: 'Cliente',
    status: 'confirmed',
    total_amount_cents: 9000,
    currency: 'USD',
    terms_version: '2026-10-15',
    charge_started_at: null,
    charge_attempts: 0,
    awaiting_action_until: null,
    recovery_deadline: null,
    tickets_adult: 1,
    tickets_child: 0,
    tickets_student: 0,
    tour_instances: { starts_at: IN_TWO_DAYS, tours: { name_es: 'T', name_en: 'T' } },
    ...overrides,
  };
}

function fakeDb(data: ReturnType<typeof row>, rpcResult: unknown = CancelBookingOutcome.Cancelled) {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data }) };
  return {
    from: () => query,
    rpc: vi.fn(async () => ({ data: rpcResult, error: null })),
  } as never;
}

const PARAMS = {
  bookingId: 'booking-1',
  actorType: AuditActorType.Tourist,
  reason: CancellationReason.CustomerRequest,
};

beforeEach(() => alert.mockClear());

describe('cancelBooking — spec 0032', () => {
  it('informa NotCancellable sin monto si otra cancelación ganó la carrera', async () => {
    const result = await cancelBooking(
      fakeDb(row(), CancelBookingOutcome.AlreadyCancelled),
      PARAMS,
      NOW,
    );
    expect(result).toEqual({ ok: false, error: CancellationError.NotCancellable });
  });

  it('envía el motivo y la comisión a la función SQL', async () => {
    const db = fakeDb(row());
    const result = await cancelBooking(db, PARAMS, NOW);
    expect(result).toEqual({
      ok: true,
      refund: { eligible: true, amountCents: 8624, feeCents: 376 },
    });
    expect((db as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      'cancel_booking',
      expect.objectContaining({
        p_reason: 'customer_request',
        p_fee_cents: 376,
        p_refund_amount_cents: 8624,
      }),
    );
  });

  it('no aplica la cancelación si la comisión no se puede calcular', async () => {
    const db = fakeDb(row({ currency: 'CRC' }));
    const result = await cancelBooking(db, PARAMS, NOW);
    expect(result).toEqual({ ok: false, error: CancellationError.WriteFailed });
    expect((db as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
  });
});

describe('cancelBooking — restricción de admin en el borde exacto', () => {
  const OPERATOR = {
    bookingId: 'booking-1',
    actorType: AuditActorType.Staff,
    reason: CancellationReason.OperatorDecision,
    isAdmin: false,
  };

  it('con la salida empezando justo ahora, un staff no reembolsa el total', async () => {
    const db = fakeDb(row({ tour_instances: { starts_at: NOW.toISOString(), tours: null } }));
    const result = await cancelBooking(db, OPERATOR, NOW);
    expect(result).toEqual({ ok: false, error: CancellationError.OperatorRefundAdminOnly });
  });

  it('con la salida a 1 ms, un staff reembolsa el total sin comisión', async () => {
    const startsAt = new Date(NOW.getTime() + 1).toISOString();
    const db = fakeDb(row({ tour_instances: { starts_at: startsAt, tours: null } }));
    const result = await cancelBooking(db, OPERATOR, NOW);
    expect(result).toEqual({
      ok: true,
      refund: { eligible: true, amountCents: 9000, feeCents: 0 },
    });
    expect((db as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      'cancel_booking',
      expect.objectContaining({ p_refund_amount_cents: 9000, p_fee_cents: 0 }),
    );
  });
});

describe('cancelBooking — lo que vio quien cancela', () => {
  it('no cancela si el estado cambió', async () => {
    const db = fakeDb(row());
    const expected = { status: 'pending_minimum', refundAmountCents: 0 };
    const result = await cancelBooking(db, { ...PARAMS, expected }, NOW);
    expect(result).toEqual({ ok: false, error: CancellationError.StateChanged });
    expect((db as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });

  it('no cancela si el monto cambió', async () => {
    const db = fakeDb(row());
    const expected = { status: 'confirmed', refundAmountCents: 9000 };
    const result = await cancelBooking(db, { ...PARAMS, expected }, NOW);
    expect(result).toEqual({ ok: false, error: CancellationError.StateChanged });
    expect((db as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });

  it('cancela si coincide con lo que vio', async () => {
    const expected = { status: 'confirmed', refundAmountCents: 8624 };
    const result = await cancelBooking(fakeDb(row()), { ...PARAMS, expected }, NOW);
    expect(result.ok).toBe(true);
  });
});

describe('getBookingView — spec 0032', () => {
  it('muestra la vista sin reembolso si la comisión no se puede calcular, y lo reporta', async () => {
    const view = await getBookingView(fakeDb(row({ currency: 'CRC' })), 'booking-1', NOW);
    expect(view?.refund).toEqual({ eligible: false, amountCents: 0, feeCents: 0 });
    expect(alert).toHaveBeenCalledOnce();
  });

  it('no calcula reembolso para una reserva que no está confirmada', async () => {
    const view = await getBookingView(fakeDb(row({ status: 'cancelled' })), 'booking-1', NOW);
    expect(view?.refund).toEqual({ eligible: false, amountCents: 0, feeCents: 0 });
    expect(alert).not.toHaveBeenCalled();
  });
});
