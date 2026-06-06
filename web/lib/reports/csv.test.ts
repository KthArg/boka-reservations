import { describe, expect, it } from 'vitest';
import { revenueToCsv, occupancyToCsv, refundsSummaryToCsv } from './csv';
import type { RevenueRow, OccupancyRow, RefundsSummary } from './types';

const BOM = '﻿';

function lines(csv: string): string[] {
  expect(csv.startsWith(BOM)).toBe(true);
  return csv.slice(BOM.length).split('\r\n');
}

describe('revenueToCsv', () => {
  it('header, montos formateados y nombre con coma entrecomillado', () => {
    const rows: RevenueRow[] = [
      {
        tourId: 't1',
        nameEs: 'Tour, A',
        nameEn: 'Tour A',
        grossCents: 10000,
        refundedCents: 2000,
        netCents: 8000,
        currency: 'USD',
      },
    ];
    const out = lines(revenueToCsv(rows, 'es'));
    expect(out[0]).toBe('tour,bruto,reembolsado,neto,moneda');
    expect(out[1]).toBe('"Tour, A",100.00,20.00,80.00,USD');
  });
});

describe('occupancyToCsv', () => {
  it('porcentajes formateados; null → vacío', () => {
    const rows: OccupancyRow[] = [
      {
        tourId: 't1',
        nameEs: 'A',
        nameEn: 'A',
        bookingsCount: 2,
        ticketsSold: 5,
        capacityTotal: 10,
        occupancyPct: 0.5,
        noShowCount: 1,
        pastBookingsCount: 2,
      },
      {
        tourId: 't2',
        nameEs: 'B',
        nameEn: 'B',
        bookingsCount: 0,
        ticketsSold: 0,
        capacityTotal: 0,
        occupancyPct: null,
        noShowCount: 0,
        pastBookingsCount: 0,
      },
    ];
    const out = lines(occupancyToCsv(rows, 'en'));
    expect(out[0]).toBe('tour,reservas,tiquetes,capacidad,ocupacion_pct,no_shows,reservas_pasadas');
    expect(out[1]).toBe('A,2,5,10,50.0,1,2');
    expect(out[2]).toBe('B,0,0,0,,0,0');
  });
});

describe('refundsSummaryToCsv', () => {
  it('una fila con la tasa de cancelación', () => {
    const summary: RefundsSummary = {
      refundsCount: 1,
      refundsAmountCents: 5000,
      cancelledCount: 1,
      validBookingsCount: 3,
      currency: 'USD',
    };
    const out = lines(refundsSummaryToCsv(summary));
    expect(out[0]).toBe(
      'reembolsos_cantidad,reembolsos_monto,canceladas,reservas_validas,tasa_cancelacion_pct,moneda',
    );
    expect(out[1]).toBe('1,50.00,1,3,33.3,USD');
  });
});
