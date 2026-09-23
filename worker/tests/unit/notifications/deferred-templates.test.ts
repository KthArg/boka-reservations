import { describe, expect, it } from 'vitest';
import { renderBookingReserved } from '../../../src/notifications/templates/booking-reserved.js';
import { renderChargeActionRequired } from '../../../src/notifications/templates/charge-action-required.js';
import { renderChargeRequiresAction } from '../../../src/notifications/templates/charge-requires-action.js';
import { renderCancellationConfirmation } from '../../../src/notifications/templates/cancellation-confirmation.js';

// Plantillas de los emails del cobro diferido (spec 0029 §4, §5.7, §5.8).

const base = {
  customerName: 'María',
  tourName: 'Cerro Chompipe',
  startsAt: '2026-10-15T13:00:00.000Z',
  totalAmountCents: 7000,
  currency: 'USD',
};

const reserved = { ...base, cardLast4: '4242', bookingUrl: 'https://x/es/booking/tok' };
const declined = {
  ...base,
  cardLast4: '4242',
  deadline: '2026-10-13T13:00:00.000Z',
  updateUrl: 'https://x/es/booking/tok/card',
};
const authentication = {
  ...base,
  deadline: '2026-10-13T13:00:00.000Z',
  authenticateUrl: 'https://x/es/booking/tok/authenticate',
};

describe('renderBookingReserved', () => {
  it('tells the tourist nothing was charged, with the amount and the card last 4 (ES)', () => {
    // Act
    const email = renderBookingReserved(reserved, 'es');

    // Assert
    expect(email.subject).toContain('registrada');
    expect(email.text).toContain('Todavía no te cobramos nada');
    expect(email.text).toMatch(/70[.,]00/);
    expect(email.text).toContain('4242');
    expect(email.html).toContain(reserved.bookingUrl);
  });

  it('renders the English copy', () => {
    // Act
    const email = renderBookingReserved(reserved, 'en');

    // Assert
    expect(email.subject).toContain('registered');
    expect(email.text).toContain("You haven't been charged yet");
  });

  it('escapes the customer name to prevent injection', () => {
    // Act
    const email = renderBookingReserved(
      { ...reserved, customerName: '<script>alert(1)</script>' },
      'es',
    );

    // Assert
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});

describe('renderChargeActionRequired', () => {
  it('links to the card update page and states until when the booking is held', () => {
    // Act
    const email = renderChargeActionRequired(declined, 'es');

    // Assert
    expect(email.subject).toContain('No pudimos cobrar');
    expect(email.html).toContain(declined.updateUrl);
    expect(email.text).toContain('terminada en 4242');
    expect(email.text).toContain('sigue guardada hasta');
    expect(email.text).toContain('sin ningún cobro');
  });

  it('renders the English copy', () => {
    // Act
    const email = renderChargeActionRequired(declined, 'en');

    // Assert
    expect(email.subject).toContain("couldn't charge");
    expect(email.text).toContain('Update my card');
  });
});

describe('renderChargeRequiresAction', () => {
  it('links to the authentication page with the deadline', () => {
    // Act
    const email = renderChargeRequiresAction(authentication, 'es');

    // Assert
    expect(email.subject).toContain('confirmar el cobro');
    expect(email.html).toContain(authentication.authenticateUrl);
    expect(email.text).toContain('Tenés hasta');
  });

  it('renders the English copy', () => {
    // Act
    const email = renderChargeRequiresAction(authentication, 'en');

    // Assert
    expect(email.text).toContain('Confirm the payment');
  });
});

describe('renderCancellationConfirmation — reserva sin cobrar', () => {
  it.each([
    ['es', 'No se hizo ningún cobro'],
    ['en', 'never charged'],
  ] as const)('says no charge was made instead of "no refund" (%s)', (locale, expected) => {
    // Act
    const email = renderCancellationConfirmation(
      {
        customerName: 'María',
        tourName: 'Cerro Chompipe',
        startsAt: base.startsAt,
        hasRefund: false,
        refundAmountCents: 0,
        feeCents: 0,
        currency: 'USD',
        noCharge: true,
        bookingUrl: 'https://x/es/booking/tok',
      },
      locale,
    );

    // Assert
    expect(email.text).toContain(expected);
    expect(email.text).not.toMatch(/política de cancelación|cancellation policy/);
  });
});
