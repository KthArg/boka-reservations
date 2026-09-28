// Función SQL cancel_booking de 6 parámetros (spec 0032) contra la DB real: validaciones de
// motivo, comisión y montos, resultado de la segunda cancelación y registro de la comisión.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CancelBookingOutcome, CancellationReason } from '@shared/constants/cancellations';
import { AuditActorType } from '@shared/constants/audit';
import { BookingStatus } from '@shared/constants/enums';
import { bookingStatus, cleanupSeeds, seed } from './cancellation-fixtures';

const CHECK_VIOLATION = '23514';

const TOTAL = 9000;
const FEE = 446;

let admin: SupabaseClient;

function cancel(
  bookingId: string,
  reason: string | null,
  refundCents: number,
  feeCents: number | null,
) {
  return admin.rpc('cancel_booking', {
    p_booking_id: bookingId,
    p_actor_type: AuditActorType.System,
    p_refund_amount_cents: refundCents,
    p_reason: reason,
    p_fee_cents: feeCents,
  });
}

beforeAll(() => {
  admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
});

afterEach(async () => {
  await cleanupSeeds(admin);
});

describe('cancel_booking — validaciones', () => {
  it.each([
    ['INVALID_REASON', 'motivo desconocido', 'refund_everything', TOTAL, 0],
    ['INVALID_REASON', 'motivo nulo', null, TOTAL, 0],
    ['INVALID_FEE', 'comisión negativa', CancellationReason.CustomerRequest, TOTAL, -1],
    ['INVALID_FEE', 'comisión nula', CancellationReason.CustomerRequest, TOTAL, null],
    ['INVALID_FEE', 'operador con comisión', CancellationReason.OperatorDecision, TOTAL - FEE, FEE],
    [
      'INVALID_REFUND_AMOUNT',
      'operador con monto parcial',
      CancellationReason.OperatorDecision,
      100,
      0,
    ],
    ['INVALID_REFUND_AMOUNT', 'operador sin monto', CancellationReason.OperatorDecision, 0, 0],
    [
      'INVALID_REFUND_AMOUNT',
      'monto + comisión sobre el total',
      CancellationReason.CustomerRequest,
      TOTAL,
      FEE,
    ],
    ['INVALID_REFUND_AMOUNT', 'monto negativo', CancellationReason.CustomerRequest, -1, 0],
  ])('rechaza con %s (%s) sin cancelar', async (code, _case, reason, refund, fee) => {
    // Arrange
    const { bookingId } = await seed(admin, { hoursAhead: 48 });

    // Act
    const { error } = await cancel(bookingId, reason, refund, fee);

    // Assert
    expect(error?.message).toContain(code);
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Confirmed);
  });
});

describe('cancel_booking — resultados', () => {
  // Spec 0034: los reembolsos son siempre completos. La base rechaza un reembolso con comisión
  // aunque un llamador la pase, y la transacción entera se deshace.
  it('rechaza un reembolso con comisión y deja la reserva como estaba', async () => {
    // Arrange
    const { bookingId } = await seed(admin, { hoursAhead: 48 });

    // Act
    const { error } = await cancel(bookingId, CancellationReason.CustomerRequest, TOTAL - FEE, FEE);

    // Assert
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toContain('refunds_no_processing_fee_check');
    expect(await bookingStatus(admin, bookingId)).toBe(BookingStatus.Confirmed);
  });

  it('sin monto a reembolsar (la comisión cubre el total) no encola reembolso', async () => {
    // Arrange
    const { bookingId } = await seed(admin, { hoursAhead: 48 });

    // Act
    const { data } = await cancel(bookingId, CancellationReason.CustomerRequest, 0, TOTAL);

    // Assert
    expect(data).toBe(CancelBookingOutcome.Cancelled);
    const { data: refunds } = await admin.from('refunds').select('id').eq('booking_id', bookingId);
    expect(refunds).toEqual([]);
  });

  it('recorta la comisión guardada si el tope por lo cobrado recorta el monto', async () => {
    // Arrange: se cobró menos que el total (caso teórico: lo impide el guard de payment_mismatch).
    const { bookingId } = await seed(admin, { hoursAhead: 48, paymentAmountCents: 8000 });

    // Act
    await cancel(bookingId, CancellationReason.CustomerRequest, TOTAL - FEE, FEE);

    // Assert
    const { data: refund } = await admin
      .from('refunds')
      .select('amount_cents, processing_fee_cents')
      .eq('booking_id', bookingId)
      .single();
    expect(refund).toEqual({ amount_cents: 8000, processing_fee_cents: 0 });
  });

  it('devuelve already_cancelled si la reserva ya no estaba confirmada', async () => {
    // Arrange
    const { bookingId } = await seed(admin, { hoursAhead: 48 });
    await cancel(bookingId, CancellationReason.OperatorDecision, TOTAL, 0);

    // Act
    const { data, error } = await cancel(bookingId, CancellationReason.OperatorDecision, TOTAL, 0);

    // Assert
    expect(error).toBeNull();
    expect(data).toBe(CancelBookingOutcome.AlreadyCancelled);
  });
});
