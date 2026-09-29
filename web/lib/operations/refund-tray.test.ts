import { describe, expect, it } from 'vitest';
import { RefundStatus } from '@shared/constants/refunds';
import { selectRefundsToResolve, type RefundTrayRow } from './refund-tray';

const NOW = new Date('2026-10-10T12:00:00.000Z');

function refund(overrides: Partial<RefundTrayRow>): RefundTrayRow {
  return {
    id: 'r-1',
    bookingId: 'b-1',
    status: RefundStatus.Failed,
    amountCents: 5000,
    currency: 'USD',
    failureReason: null,
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
    transferRequestedAt: null,
    customerName: 'Ana',
    tourName: 'Tour',
    startsAt: '2026-10-20T14:00:00.000Z',
    ...overrides,
  };
}

describe('selectRefundsToResolve', () => {
  it('muestra los fallidos y los que esperan transferencia', () => {
    const rows = [
      refund({ id: 'a', bookingId: 'b-1' }),
      refund({
        id: 'b',
        bookingId: 'b-2',
        status: RefundStatus.AwaitingTransfer,
        transferRequestedAt: '2026-10-09T09:00:00.000Z',
      }),
    ];
    expect(selectRefundsToResolve(rows, NOW).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('un fallido viejo con un reembolso más nuevo acreditado no aparece', () => {
    const rows = [
      refund({ id: 'viejo', createdAt: '2026-10-01T10:00:00.000Z' }),
      refund({
        id: 'nuevo',
        status: RefundStatus.Succeeded,
        createdAt: '2026-10-05T10:00:00.000Z',
      }),
    ];
    expect(selectRefundsToResolve(rows, NOW)).toEqual([]);
  });

  it('de varios fallidos de la misma reserva queda uno, el más nuevo', () => {
    const rows = [
      refund({ id: 'viejo', createdAt: '2026-10-01T10:00:00.000Z' }),
      refund({ id: 'nuevo', createdAt: '2026-10-05T10:00:00.000Z' }),
    ];
    expect(selectRefundsToResolve(rows, NOW).map((r) => r.id)).toEqual(['nuevo']);
  });

  it('uno en cola aparece solo si no cambia hace más de 24 horas', () => {
    const recent = refund({
      id: 'reciente',
      bookingId: 'b-1',
      status: RefundStatus.Pending,
      updatedAt: '2026-10-10T00:00:00.000Z',
    });
    const stuck = refund({
      id: 'atascado',
      bookingId: 'b-2',
      status: RefundStatus.Processing,
      updatedAt: '2026-10-09T11:00:00.000Z',
    });
    expect(selectRefundsToResolve([recent, stuck], NOW).map((r) => r.id)).toEqual(['atascado']);
  });

  it('espera desde el pedido de transferencia y ordena del más antiguo al más nuevo', () => {
    const rows = [
      refund({ id: 'fallido', bookingId: 'b-1', updatedAt: '2026-10-09T10:00:00.000Z' }),
      refund({
        id: 'transferencia',
        bookingId: 'b-2',
        status: RefundStatus.AwaitingTransfer,
        updatedAt: '2026-10-09T20:00:00.000Z',
        transferRequestedAt: '2026-10-07T10:00:00.000Z',
      }),
    ];
    const result = selectRefundsToResolve(rows, NOW);
    expect(result.map((r) => r.id)).toEqual(['transferencia', 'fallido']);
    expect(result[0].waitingSince).toBe('2026-10-07T10:00:00.000Z');
  });
});
