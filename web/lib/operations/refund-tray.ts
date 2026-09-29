import { RefundStatus, STUCK_REFUND_HOURS } from '@shared/constants/refunds';

const MS_PER_HOUR = 3_600_000;

/** Un reembolso con lo que la bandeja necesita mostrar. */
export type RefundTrayRow = {
  id: string;
  bookingId: string;
  status: RefundStatus;
  amountCents: number;
  currency: string;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  transferRequestedAt: string | null;
  customerName: string;
  tourName: string;
  startsAt: string;
};

export type RefundToResolve = RefundTrayRow & { waitingSince: string };

const NEEDS_ACTION: readonly RefundStatus[] = [RefundStatus.Failed, RefundStatus.AwaitingTransfer];
const IN_FLIGHT: readonly RefundStatus[] = [RefundStatus.Pending, RefundStatus.Processing];

/**
 * Reembolsos que esperan algo del operador (spec 0038). Por reserva cuenta solo el más nuevo por
 * `created_at`, el mismo que muestra el detalle: un `failed` viejo con un reembolso nuevo que ya
 * se acreditó no aparece. Entran los `failed` y `awaiting_transfer`, y los que están en cola o
 * procesando pero no cambian hace más de STUCK_REFUND_HOURS (el worker no los está moviendo).
 * Del más antiguo al más nuevo.
 */
export function selectRefundsToResolve(rows: RefundTrayRow[], now: Date): RefundToResolve[] {
  const latest = new Map<string, RefundTrayRow>();
  for (const row of rows) {
    const current = latest.get(row.bookingId);
    if (!current || row.createdAt > current.createdAt) latest.set(row.bookingId, row);
  }

  const stuckBefore = now.getTime() - STUCK_REFUND_HOURS * MS_PER_HOUR;
  return [...latest.values()]
    .filter(
      (row) =>
        NEEDS_ACTION.includes(row.status) ||
        (IN_FLIGHT.includes(row.status) && new Date(row.updatedAt).getTime() < stuckBefore),
    )
    .map((row) => ({
      ...row,
      waitingSince:
        row.status === RefundStatus.AwaitingTransfer && row.transferRequestedAt
          ? row.transferRequestedAt
          : row.updatedAt,
    }))
    .sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
}
