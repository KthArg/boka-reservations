import { describe, expect, it } from 'vitest';
import { renderBookingConfirmation } from '../../../src/notifications/templates/booking-confirmation.js';
import { renderReminder24h } from '../../../src/notifications/templates/reminder-24h.js';

const confirmationProps = {
  customerName: 'María',
  tourName: 'Birdwatching Monteverde',
  startsAt: '2026-06-15T13:00:00.000Z',
  meetingPoint: 'Parque central, Monteverde',
  ticketsAdult: 2,
  ticketsChild: 1,
  ticketsStudent: 0,
  totalAmountCents: 15_000,
  currency: 'USD',
  bookingUrl: 'https://example.com/es/reserva/abc',
};

const reminderProps = {
  customerName: 'María',
  tourName: 'Birdwatching Monteverde',
  startsAt: '2026-06-15T13:00:00.000Z',
  meetingPoint: 'Parque central, Monteverde',
  bookingUrl: 'https://example.com/es/reserva/abc',
};

describe('renderBookingConfirmation', () => {
  it('produce subject, html y text en ES con datos clave', () => {
    const out = renderBookingConfirmation(confirmationProps, 'es');
    expect(out.subject).toContain('Birdwatching Monteverde');
    expect(out.subject).toMatch(/confirmada/i);
    expect(out.html).toContain('Birdwatching Monteverde');
    expect(out.html).toContain('Parque central, Monteverde');
    expect(out.html).toContain(confirmationProps.bookingUrl);
    expect(out.text).toContain('Birdwatching Monteverde');
    expect(out.text).toContain('2 adulto(s)');
    expect(out.text).toContain('1 niño(s)');
    expect(out.text).not.toContain('estudiante');
  });

  it('produce versión EN con copy traducido', () => {
    const out = renderBookingConfirmation(confirmationProps, 'en');
    expect(out.subject).toMatch(/confirmed/i);
    expect(out.text).toContain('2 adult(s)');
    expect(out.text).toContain('1 child(ren)');
    expect(out.html).toMatch(/Date and time/);
  });

  it('escapa html del nombre del cliente para prevenir injection', () => {
    const out = renderBookingConfirmation(
      { ...confirmationProps, customerName: '<script>alert(1)</script>' },
      'es',
    );
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('formatea monto con la moneda recibida', () => {
    const out = renderBookingConfirmation(confirmationProps, 'es');
    expect(out.text).toMatch(/150[.,]00/);
  });
});

describe('renderReminder24h', () => {
  it('produce subject, html y text en ES', () => {
    const out = renderReminder24h(reminderProps, 'es');
    expect(out.subject).toContain('Birdwatching Monteverde');
    expect(out.subject).toMatch(/mañana/i);
    expect(out.html).toContain(reminderProps.meetingPoint);
    expect(out.html).toContain(reminderProps.bookingUrl);
  });

  it('produce subject EN', () => {
    const out = renderReminder24h(reminderProps, 'en');
    expect(out.subject).toMatch(/tomorrow/i);
  });
});
