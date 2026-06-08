import { describe, it, expect } from 'vitest';
import { bookingsToCsv } from './csv';
import type { AdminExportRow } from './admin-types';

function row(overrides: Partial<AdminExportRow> = {}): AdminExportRow {
  return {
    id: 'b1',
    tourName: 'Volcán Poás',
    startsAt: '2026-05-30T20:00:00Z',
    customerName: 'Ana Pérez',
    customerEmail: 'ana@example.com',
    ticketsAdult: 2,
    ticketsChild: 1,
    ticketsStudent: 0,
    totalTickets: 3,
    status: 'confirmed',
    paymentStatus: 'succeeded',
    totalAmountCents: 12500,
    currency: 'USD',
    checkedInAt: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('bookingsToCsv', () => {
  it('arranca con BOM y la cabecera en el orden definido', () => {
    const csv = bookingsToCsv([]);
    expect(csv.startsWith('﻿')).toBe(true);
    const header = csv.slice(1).split('\r\n')[0];
    expect(header).toBe(
      'booking_id,tour,fecha_inicio,hora_inicio,cliente,email,tickets_adult,tickets_child,tickets_student,total_tickets,estado_reserva,estado_pago,monto,moneda,check_in_at,created_at',
    );
  });

  it('convierte centavos a unidad mayor con dos decimales', () => {
    const line = bookingsToCsv([row({ totalAmountCents: 12500 })]).split('\r\n')[1];
    expect(line).toContain(',125.00,USD,');
  });

  it('formatea fecha/hora en la zona del operador (UTC-6)', () => {
    // 20:00Z = 14:00 CR del mismo día
    const line = bookingsToCsv([row({ startsAt: '2026-05-30T20:00:00Z' })]).split('\r\n')[1];
    expect(line).toContain('2026-05-30,14:00,');
  });

  it('entrecomilla nombres con coma y duplica comillas internas', () => {
    const line = bookingsToCsv([row({ customerName: 'Pérez, Ana "La Guía"' })]).split('\r\n')[1];
    expect(line).toContain('"Pérez, Ana ""La Guía"""');
  });

  it('exporta vacío para check_in_at nulo', () => {
    const line = bookingsToCsv([row({ checkedInAt: null })]).split('\r\n')[1];
    expect(line.endsWith(',2026-05-01T10:00:00.000Z')).toBe(true);
  });
});
