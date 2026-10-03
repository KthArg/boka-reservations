// Salidas con turistas y sin guía (spec 0043): qué entra a la bandeja, qué es urgente y el tope.
import { describe, expect, it } from 'vitest';
import { guidelessTray, isGuideUrgent, needsGuide } from './needs-guide';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-10-03T12:00:00Z');
const inHours = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS).toISOString();

const GUIDE = { id: 'g1', fullName: 'Guía' };

function departure(overrides: Partial<Parameters<typeof needsGuide>[0]> = {}) {
  return {
    startsAt: inHours(48),
    liveTickets: 2,
    assignedGuide: null,
    assignedGuideActive: false,
    ...overrides,
  };
}

describe('needsGuide', () => {
  it('flags a departure with tourists and no guide', () => {
    expect(needsGuide(departure(), NOW)).toBe(true);
  });

  it('ignores a departure without live bookings', () => {
    expect(needsGuide(departure({ liveTickets: 0 }), NOW)).toBe(false);
  });

  it('ignores a departure with an active guide', () => {
    expect(needsGuide(departure({ assignedGuide: GUIDE, assignedGuideActive: true }), NOW)).toBe(
      false,
    );
  });

  // Un guía desactivado no va a ir: la salida está igual de desatendida.
  it('flags a departure whose guide was deactivated', () => {
    expect(needsGuide(departure({ assignedGuide: GUIDE, assignedGuideActive: false }), NOW)).toBe(
      true,
    );
  });

  it('looks 14 days ahead, not further', () => {
    expect(needsGuide(departure({ startsAt: inHours(14 * 24 - 1) }), NOW)).toBe(true);
    expect(needsGuide(departure({ startsAt: inHours(14 * 24) }), NOW)).toBe(false);
  });

  it('ignores a departure that already started', () => {
    expect(needsGuide(departure({ startsAt: inHours(-1) }), NOW)).toBe(false);
  });
});

describe('isGuideUrgent', () => {
  it('is urgent with less than 24 h and not at exactly 24 h', () => {
    expect(isGuideUrgent({ startsAt: inHours(23.9) }, NOW)).toBe(true);
    expect(isGuideUrgent({ startsAt: inHours(24) }, NOW)).toBe(false);
  });
});

describe('guidelessTray', () => {
  it('orders by start time and caps the tray at 30', () => {
    // Arrange
    const departures = Array.from({ length: 31 }, (_, i) =>
      departure({ startsAt: inHours(60 - i) }),
    );

    // Act
    const { shown, hidden } = guidelessTray(departures, NOW);

    // Assert
    expect(shown).toHaveLength(30);
    expect(hidden).toBe(1);
    expect(shown[0]?.startsAt).toBe(inHours(30));
  });
});
