import { describe, expect, it } from 'vitest';
import { renderGuideAssignment } from '../../../src/notifications/templates/guide-assignment.js';
import { hashGuideToken } from '../../../src/notifications/guide-token.js';

const props = {
  guideName: 'Carlos Ríos',
  tourName: 'Birdwatching La Selva',
  startsAt: '2026-06-15T11:30:00.000Z',
  meetingPoint: 'Portón principal de La Selva',
  passengerCount: 6,
  upcomingUrl: 'https://example.com/es/guia/tok123/proximos-tours',
};

describe('renderGuideAssignment', () => {
  it('produce subject, html y text en ES con datos clave', () => {
    const out = renderGuideAssignment(props, 'es');
    expect(out.subject).toContain('Birdwatching La Selva');
    expect(out.subject).toMatch(/asignaron/i);
    expect(out.html).toContain('Carlos Ríos');
    expect(out.html).toContain('Portón principal de La Selva');
    expect(out.html).toContain(props.upcomingUrl);
    expect(out.text).toContain('6 confirmado(s)');
  });

  it('produce versión EN con copy traducido', () => {
    const out = renderGuideAssignment(props, 'en');
    expect(out.subject).toMatch(/assigned/i);
    expect(out.text).toContain('6 confirmed');
    expect(out.html).toMatch(/Meeting point/);
  });

  it('escapa html del nombre del guía para prevenir injection', () => {
    const out = renderGuideAssignment({ ...props, guideName: '<script>x</script>' }, 'es');
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
});

describe('hashGuideToken', () => {
  it('es determinístico y produce un hash sha256 hex', () => {
    const a = hashGuideToken('abc123');
    const b = hashGuideToken('abc123');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produce hashes distintos para tokens distintos', () => {
    expect(hashGuideToken('token-a')).not.toBe(hashGuideToken('token-b'));
  });
});
