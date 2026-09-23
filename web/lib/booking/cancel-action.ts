'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { validateBookingToken } from './access-token';
import { cancelBooking, type CancelExpectation, type CancelResult } from './cancel';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import { AuditActorType, actorTypeForRole } from '@shared/constants/audit';
import { CancellationError, CancellationReason } from '@shared/constants/cancellations';
import { BookingStatus, UserRole } from '@shared/constants/enums';

const ADMIN_DETAIL_BASE = '/dashboard/bookings';

// Lo que llega del navegador se valida acá (spec 0032): motivo y lo que se le mostró.
const ReasonSchema = z.enum([
  CancellationReason.CustomerRequest,
  CancellationReason.OperatorDecision,
]);
const ExpectationSchema = z.object({
  status: z.string().min(1),
  refundAmountCents: z.number().int().nonnegative(),
});
const RefundCentsSchema = z.number().int().nonnegative();

/**
 * Cancela una reserva desde el flujo self-service del turista. El acceso se valida por el token
 * hasheado del magic link, no por id crudo. `expected` es lo que mostró la página: si al
 * confirmar la reserva cambió (p. ej. el cobro diferido se completó), no se cancela (spec 0032).
 */
export async function cancelByToken(token: string, expected?: unknown): Promise<CancelResult> {
  const db = createSupabaseServiceClient();
  const bookingId = await validateBookingToken(db, token);
  if (!bookingId) return { ok: false, error: CancellationError.InvalidToken };

  const parsed = ExpectationSchema.safeParse(expected);
  if (!parsed.success) return { ok: false, error: CancellationError.StateChanged };

  return cancelBooking(db, {
    bookingId,
    actorType: AuditActorType.Tourist,
    reason: CancellationReason.CustomerRequest,
    expected: parsed.data,
  });
}

/**
 * Cancela una reserva desde el panel. Solo admin/staff; queda auditado. Para una reserva cobrada,
 * `reason` es obligatorio: decide si el reembolso descuenta la comisión (spec 0032), y
 * `expectedRefundCents` es el monto que mostró el diálogo para ese motivo.
 */
export async function cancelByStaff(
  bookingId: string,
  reason?: unknown,
  expectedRefundCents?: unknown,
): Promise<CancelResult> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user?.userRole) return { ok: false, error: CancellationError.Unauthorized };

  const parsedReason = ReasonSchema.safeParse(reason);
  const parsedCents = RefundCentsSchema.safeParse(expectedRefundCents);
  const expected: CancelExpectation | undefined = parsedCents.success
    ? { status: BookingStatus.Confirmed, refundAmountCents: parsedCents.data }
    : undefined;

  const db = createSupabaseServiceClient();
  const result = await cancelBooking(db, {
    bookingId,
    actorType: actorTypeForRole(user.userRole),
    actorId: user.id,
    reason: parsedReason.success ? parsedReason.data : undefined,
    isAdmin: user.userRole === UserRole.Admin,
    expected,
  });

  if (result.ok) {
    revalidatePath(ADMIN_DETAIL_BASE);
    revalidatePath(`${ADMIN_DETAIL_BASE}/${bookingId}`);
  }
  return result;
}
