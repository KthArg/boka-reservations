// Reembolso sin la comisión de procesamiento (spec 0032), por las server actions y contra la DB
// real: motivo, política activa por versión de términos, restricción de admin sobre salidas ya
// empezadas, cambio de estado entre la pantalla y la confirmación, y carrera entre dos
// cancelaciones. Las validaciones de la función SQL están en cancel-booking-rpc.test.ts.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CancellationError, CancellationReason } from '@shared/constants/cancellations';
import { BookingStatus, UserRole } from '@shared/constants/enums';
import { bookingStatus, cleanupSeeds, seed } from './cancellation-fixtures';

vi.mock('server-only', () => ({}));
const requireAnyRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/server', () => ({ requireAnyRole: requireAnyRoleMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// La política se despliega inactiva (REFUND_FEE_FROM_TERMS_VERSION = null). Para probarla
// activa, computeRefund recibe el corte de la suite; los fixtures usan versiones con fecha.
const CUTOFF = '2026-10-01';
vi.mock('@shared/constants/policies', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@shared/constants/policies')>();
  return {
    ...mod,
    computeRefund: (input: Parameters<typeof mod.computeRefund>[0]) =>
      mod.computeRefund({ feeFromTermsVersion: CUTOFF, ...input }),
  };
});

const { cancelByStaff, cancelByToken } = await import('@/lib/booking/cancel-action');

// 9000 centavos: 3,9 % = 351 + 35 fijos.
const TOTAL = 9000;
const FEE = 386;
const SEEN_WITH_FEE = { status: BookingStatus.Confirmed, refundAmountCents: TOTAL - FEE };

let admin: SupabaseClient;
let staffUserId: string;
let adminUserId: string;

async function refundRow(bookingId: string) {
  const { data } = await admin
    .from('refunds')
    .select('amount_cents, processing_fee_cents')
    .eq('booking_id', bookingId);
  return data ?? [];
}

async function cancellationAudit(bookingId: string) {
  const { data } = await admin
    .from('audit_logs')
    .select('metadata')
    .eq('entity_id', bookingId)
    .eq('action', 'booking.cancelled')
    .single();
  return data!.metadata as Record<string, unknown>;
}

function actAs(role: UserRole) {
  const id = role === UserRole.Admin ? adminUserId : staffUserId;
  requireAnyRoleMock.mockResolvedValue({ id, userRole: role });
}

beforeAll(async () => {
  admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const users = await admin
    .from('users')
    .select('id, role')
    .in('role', [UserRole.Staff, UserRole.Admin]);
  staffUserId = users.data!.find((u) => u.role === UserRole.Staff)!.id;
  adminUserId = users.data!.find((u) => u.role === UserRole.Admin)!.id;
});

afterEach(async () => {
  requireAnyRoleMock.mockReset();
  await cleanupSeeds(admin);
});

describe('cancelación del turista con la política activa', () => {
  it('reembolsa el total menos la comisión y la registra', async () => {
    // Arrange
    const { bookingId, token } = await seed(admin, { hoursAhead: 48, termsVersion: CUTOFF });

    // Act
    const result = await cancelByToken(token, SEEN_WITH_FEE);

    // Assert
    expect(result).toEqual({
      ok: true,
      refund: { eligible: true, amountCents: TOTAL - FEE, feeCents: FEE },
    });
    expect(await refundRow(bookingId)).toEqual([
      { amount_cents: TOTAL - FEE, processing_fee_cents: FEE },
    ]);
    expect(await cancellationAudit(bookingId)).toMatchObject({
      reason: CancellationReason.CustomerRequest,
      fee_cents: FEE,
      refund_amount_cents: TOTAL - FEE,
    });
  });

  it.each([
    ['sin versión de términos', null],
    ['con términos anteriores al corte', '2026-09-30'],
  ])('reembolsa el total %s', async (_case, termsVersion) => {
    // Arrange
    const { bookingId, token } = await seed(admin, { hoursAhead: 48, termsVersion });

    // Act
    await cancelByToken(token, { status: BookingStatus.Confirmed, refundAmountCents: TOTAL });

    // Assert
    expect(await refundRow(bookingId)).toEqual([{ amount_cents: TOTAL, processing_fee_cents: 0 }]);
  });

  it('no cancela si la reserva cambió desde que se mostró la página', async () => {
    // Arrange: la página se mostró sin cobrar; el cobro diferido se completó antes de confirmar.
    const { bookingId, token } = await seed(admin, { hoursAhead: 12, termsVersion: CUTOFF });

    // Act
    const result = await cancelByToken(token, {
      status: BookingStatus.PendingMinimum,
      refundAmountCents: 0,
    });

    // Assert
    expect(result).toEqual({ ok: false, error: CancellationError.StateChanged });
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Confirmed);
  });

  it('no cancela si el monto mostrado ya no es el que corresponde', async () => {
    // Arrange: la página mostró el total; con la cláusula aceptada corresponde descontar.
    const { bookingId, token } = await seed(admin, { hoursAhead: 48, termsVersion: CUTOFF });

    // Act
    const result = await cancelByToken(token, {
      status: BookingStatus.Confirmed,
      refundAmountCents: TOTAL,
    });

    // Assert
    expect(result).toEqual({ ok: false, error: CancellationError.StateChanged });
    expect(await refundRow(bookingId)).toEqual([]);
  });
});

describe('cancelación desde el panel', () => {
  it('exige el motivo para una reserva cobrada, sin tocarla', async () => {
    actAs(UserRole.Staff);
    const { bookingId } = await seed(admin, { hoursAhead: 48 });

    const result = await cancelByStaff(bookingId);

    expect(result).toEqual({ ok: false, error: CancellationError.ReasonRequired });
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Confirmed);
  });

  it('rechaza un motivo desconocido enviado desde el cliente', async () => {
    actAs(UserRole.Staff);
    const { bookingId } = await seed(admin, { hoursAhead: 48 });

    const result = await cancelByStaff(bookingId, 'refund_everything');

    expect(result).toEqual({ ok: false, error: CancellationError.ReasonRequired });
  });

  it('por decisión del operador reembolsa el total aun dentro de las 24 h', async () => {
    actAs(UserRole.Staff);
    const { bookingId } = await seed(admin, { hoursAhead: 12, termsVersion: CUTOFF });

    const result = await cancelByStaff(bookingId, CancellationReason.OperatorDecision, TOTAL);

    expect(result).toEqual({
      ok: true,
      refund: { eligible: true, amountCents: TOTAL, feeCents: 0 },
    });
    expect(await refundRow(bookingId)).toEqual([{ amount_cents: TOTAL, processing_fee_cents: 0 }]);
    expect(await cancellationAudit(bookingId)).toMatchObject({
      reason: CancellationReason.OperatorDecision,
      fee_cents: 0,
    });
  });

  it('a pedido del cliente aplica la misma regla que el turista', async () => {
    actAs(UserRole.Staff);
    const { bookingId } = await seed(admin, { hoursAhead: 48, termsVersion: CUTOFF });

    const result = await cancelByStaff(bookingId, CancellationReason.CustomerRequest, TOTAL - FEE);

    expect(result).toMatchObject({ ok: true, refund: { amountCents: TOTAL - FEE, feeCents: FEE } });
  });

  it('no cancela si el monto que vio el staff ya no corresponde', async () => {
    actAs(UserRole.Staff);
    const { bookingId } = await seed(admin, { hoursAhead: 12 });

    // El diálogo mostró el total a pedido del cliente; ya se cruzó el borde de 24 h.
    const result = await cancelByStaff(bookingId, CancellationReason.CustomerRequest, TOTAL);

    expect(result).toEqual({ ok: false, error: CancellationError.StateChanged });
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Confirmed);
  });

  it('un staff no reembolsa el total de una salida que ya empezó', async () => {
    actAs(UserRole.Staff);
    const { bookingId } = await seed(admin, { hoursAhead: -1 });

    const result = await cancelByStaff(bookingId, CancellationReason.OperatorDecision, TOTAL);

    expect(result).toEqual({ ok: false, error: CancellationError.OperatorRefundAdminOnly });
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Confirmed);
  });

  it('un admin sí reembolsa el total de una salida que ya empezó', async () => {
    actAs(UserRole.Admin);
    const { bookingId } = await seed(admin, { hoursAhead: -1 });

    const result = await cancelByStaff(bookingId, CancellationReason.OperatorDecision, TOTAL);

    expect(result).toMatchObject({ ok: true, refund: { amountCents: TOTAL } });
  });
});

describe('cancelaciones simultáneas', () => {
  it('aplica una sola y encola un solo reembolso', async () => {
    // Arrange
    actAs(UserRole.Admin);
    const { bookingId, token } = await seed(admin, { hoursAhead: 48, termsVersion: CUTOFF });

    // Act
    const results = await Promise.all([
      cancelByToken(token, SEEN_WITH_FEE),
      cancelByStaff(bookingId, CancellationReason.OperatorDecision, TOTAL),
    ]);

    // Assert
    const applied = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok);
    expect(applied).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect([CancellationError.NotCancellable, CancellationError.StateChanged]).toContain(
      (rejected[0] as { error: CancellationError }).error,
    );
    expect(await refundRow(bookingId)).toHaveLength(1);
  });
});
