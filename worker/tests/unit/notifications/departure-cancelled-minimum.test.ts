import { describe, expect, it } from 'vitest';
import { renderDepartureCancelledMinimum } from '../../../src/notifications/templates/departure-cancelled-minimum.js';

// Aviso de salida cancelada por no alcanzar el mínimo (spec 0033 §5.12). Nunca hubo cobro; la
// aclaración de la retención solo aparece cuando hubo autorización, y aun así sin afirmarla.

const base = {
  customerName: 'María',
  tourName: 'Cerro Chompipe',
  startsAt: '2026-06-15T13:00:00.000Z',
  hadAuthorization: false,
  toursUrl: 'http://localhost:3000/es/tours',
};

describe('renderDepartureCancelledMinimum', () => {
  it('anuncia la cancelación por mínimo y que no hubo cobro (ES)', () => {
    // Act
    const email = renderDepartureCancelledMinimum(base, 'es');

    // Assert
    expect(email.subject).toContain('cancelada');
    expect(email.text).toContain('no alcanzó el mínimo de participantes');
    expect(email.text).toContain('No se hizo ningún cobro');
    expect(email.text).toContain('Cerro Chompipe');
  });

  it('announces the cancellation and that no charge was made (EN)', () => {
    // Act
    const email = renderDepartureCancelledMinimum(base, 'en');

    // Assert
    expect(email.subject).toContain('cancelled');
    expect(email.text).toContain('did not reach the minimum number of participants');
    expect(email.text).toContain('Your card was not charged');
  });

  it('explica la retención temporal cuando hubo autorización (ES)', () => {
    // Act
    const email = renderDepartureCancelledMinimum({ ...base, hadAuthorization: true }, 'es');

    // Assert
    expect(email.text).toContain('retención temporal');
    expect(email.text).toContain('días hábiles');
    expect(email.html).toContain('retención temporal');
  });

  it('explains the temporary hold when the card was authorized (EN)', () => {
    // Act
    const email = renderDepartureCancelledMinimum({ ...base, hadAuthorization: true }, 'en');

    // Assert
    expect(email.text).toContain('temporary hold');
    expect(email.text).toContain('business days');
  });

  it('no menciona ninguna retención cuando no hubo autorización', () => {
    // Act
    const es = renderDepartureCancelledMinimum(base, 'es');
    const en = renderDepartureCancelledMinimum(base, 'en');

    // Assert
    expect(es.text).not.toContain('retención');
    expect(es.html).not.toContain('retención');
    expect(en.text).not.toContain('hold');
  });

  it('invita a reservar otra fecha con el enlace a los tours', () => {
    // Act
    const email = renderDepartureCancelledMinimum(base, 'es');

    // Assert
    expect(email.text).toContain(base.toursUrl);
    expect(email.html).toContain(base.toursUrl);
    expect(email.text).toContain('otra fecha');
  });

  it('escapa el nombre del turista en el HTML', () => {
    // Act
    const email = renderDepartureCancelledMinimum(
      { ...base, customerName: '<script>x</script>' },
      'es',
    );

    // Assert
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
