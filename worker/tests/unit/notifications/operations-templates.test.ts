// Plantillas de la operación que prometen los términos (spec 0035).
import { describe, expect, it } from 'vitest';
import { renderDepartureCancelled } from '../../../src/notifications/templates/departure-cancelled.js';
import { renderBookingRescheduled } from '../../../src/notifications/templates/booking-rescheduled.js';
import { renderRefundTransferRequest } from '../../../src/notifications/templates/refund-transfer-request.js';
import { renderRefundConfirmation } from '../../../src/notifications/templates/refund-confirmation.js';

const BASE = {
  customerName: 'María',
  tourName: 'Cerro Chompipe',
  startsAt: '2026-10-15T13:00:00.000Z',
  toursUrl: 'https://example.com/es/tours',
};

describe('renderDepartureCancelled', () => {
  it('por mínimo anuncia el reembolso del 100 % con el monto', () => {
    const email = renderDepartureCancelled(
      {
        ...BASE,
        reason: 'minimum',
        outcome: { kind: 'refund', amountCents: 9000, currency: 'USD' },
      },
      'es',
    );
    expect(email.text).toContain('mínimo de participantes');
    expect(email.text).toContain('100 %');
    expect(email.text).toContain('90,00');
  });

  it('por clima dice que la reserva está en revisión, sin monto', () => {
    const email = renderDepartureCancelled(
      { ...BASE, reason: 'weather', outcome: { kind: 'review' } },
      'es',
    );
    expect(email.text).toContain('clima');
    expect(email.text).toContain('revisando tu reserva');
    expect(email.text).not.toContain('Te devolvemos');
  });

  it('sin cobro no promete ningún reembolso (EN)', () => {
    const email = renderDepartureCancelled(
      { ...BASE, reason: 'safety', outcome: { kind: 'no_charge' } },
      'en',
    );
    expect(email.text).toContain('safety reasons');
    expect(email.text).toContain('Your card was not charged.');
  });
});

describe('renderBookingRescheduled', () => {
  it('da la nueva fecha, el punto de encuentro y aclara que el monto no cambia', () => {
    const email = renderBookingRescheduled(
      {
        customerName: 'María',
        tourName: 'Cerro Chompipe',
        startsAt: BASE.startsAt,
        meetingPoint: 'Parque central',
        bookingUrl: 'https://example.com/es/booking/tok',
      },
      'es',
    );
    expect(email.text).toContain('Nueva fecha y hora');
    expect(email.text).toContain('Parque central');
    expect(email.text).toContain('Lo que pagaste no cambia');
  });
});

describe('renderRefundTransferRequest', () => {
  it('pide los datos de una cuenta a nombre de quien reservó', () => {
    const email = renderRefundTransferRequest(
      {
        customerName: 'María',
        tourName: 'Cerro Chompipe',
        amountCents: 9000,
        currency: 'USD',
        bookingUrl: 'https://example.com/es/booking/tok',
      },
      'es',
    );
    expect(email.text).toContain('90,00');
    expect(email.text).toContain('a nombre de la persona que hizo la reserva');
    expect(email.text).toContain('SINPE Móvil');
  });
});

describe('renderRefundConfirmation — por transferencia', () => {
  it('nombra el canal por el que se devolvió', () => {
    const email = renderRefundConfirmation(
      {
        customerName: 'María',
        tourName: 'Cerro Chompipe',
        refundAmountCents: 9000,
        currency: 'USD',
        transferChannel: 'sinpe_movil',
      },
      'es',
    );
    expect(email.text).toContain('por SINPE Móvil');
  });
});
