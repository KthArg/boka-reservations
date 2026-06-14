// PRIV-07 (spec 0023): el cuerpo de error de Resend puede ecoar el email del destinatario;
// se redacta antes de propagarlo a notifications.last_error.
import { describe, expect, it } from 'vitest';
import { redactErrorBody } from '../../../src/notifications/adapters/resend.js';

describe('redactErrorBody (PRIV-07)', () => {
  it('redacta direcciones de email del cuerpo de error', () => {
    expect(redactErrorBody('Invalid recipient: juan.perez@gmail.com was rejected')).toBe(
      'Invalid recipient: [email] was rejected',
    );
  });

  it('acota la longitud a 300 caracteres', () => {
    expect(redactErrorBody('x'.repeat(500)).length).toBe(300);
  });

  it('deja intacto un cuerpo sin email', () => {
    expect(redactErrorBody('rate limit exceeded')).toBe('rate limit exceeded');
  });
});
