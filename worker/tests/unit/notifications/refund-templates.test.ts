import { describe, it, expect } from 'vitest';
import { renderCancellationConfirmation } from '../../../src/notifications/templates/cancellation-confirmation.js';
import { renderRefundConfirmation } from '../../../src/notifications/templates/refund-confirmation.js';
import { renderOverbookedRefunded } from '../../../src/notifications/templates/overbooked-refunded.js';

const cancelBase = {
  customerName: 'María',
  tourName: 'Cerro Chompipe',
  startsAt: '2026-06-15T13:00:00.000Z',
  refundAmountCents: 9000,
  currency: 'USD',
  bookingUrl: 'http://localhost:3000/es/booking/tok',
};

describe('renderCancellationConfirmation', () => {
  it('anuncia el reembolso cuando corresponde (ES)', () => {
    const email = renderCancellationConfirmation({ ...cancelBase, hasRefund: true }, 'es');
    expect(email.subject).toContain('cancelada');
    expect(email.text).toContain('90,00');
    expect(email.html).toContain(cancelBase.bookingUrl);
  });

  it('indica que no hay reembolso cuando no corresponde (EN)', () => {
    const email = renderCancellationConfirmation(
      { ...cancelBase, hasRefund: false, refundAmountCents: 0 },
      'en',
    );
    expect(email.subject).toContain('cancelled');
    expect(email.text).toContain('no refund');
    expect(email.text).not.toContain('$0.00');
  });
});

describe('renderRefundConfirmation', () => {
  it('incluye el monto reembolsado', () => {
    const email = renderRefundConfirmation(
      {
        customerName: 'María',
        tourName: 'Cerro Chompipe',
        refundAmountCents: 9000,
        currency: 'USD',
      },
      'es',
    );
    expect(email.subject).toContain('reembolso');
    expect(email.text).toContain('90,00');
  });
});

describe('renderOverbookedRefunded (spec 0025)', () => {
  const base = {
    customerName: 'María',
    tourName: 'Cerro Chompipe',
    startsAt: '2026-06-15T13:00:00.000Z',
    refundAmountCents: 7000,
    currency: 'USD',
  };

  it('anuncia el cupo agotado y el reembolso total (ES)', () => {
    const email = renderOverbookedRefunded(base, 'es');
    expect(email.subject).toContain('cupo');
    expect(email.text).toContain('70,00');
  });

  it('announces sold out and full refund (EN)', () => {
    const email = renderOverbookedRefunded(base, 'en');
    expect(email.subject).toContain('sold out');
    expect(email.text).toContain('70.00');
  });
});
