// Salidas con turistas y sin guía (spec 0043): qué entra a la bandeja, qué es urgente y el tope.
import { describe, expect, it } from 'vitest';
import { guidelessTray, isGuideUrgent, needsGuide } from './needs-guide';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-10-03T12:00:00Z');
/** La ventana inicial de Configuración. */
const DAYS = 14;
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
    expect(needsGuide(departure(), NOW, DAYS)).toBe(true);
  });

  it('ignores a departure without live bookings', () => {
    expect(needsGuide(departure({ liveTickets: 0 }), NOW, DAYS)).toBe(false);
  });

  it('ignores a departure with an active guide', () => {
    expect(
      needsGuide(departure({ assignedGuide: GUIDE, assignedGuideActive: true }), NOW, DAYS),
    ).toBe(false);
  });

  // Un guía desactivado no va a ir: la salida está igual de desatendida.
  it('flags a departure whose guide was deactivated', () => {
    expect(
      needsGuide(departure({ assignedGuide: GUIDE, assignedGuideActive: false }), NOW, DAYS),
    ).toBe(true);
  });

  it('looks 14 days ahead, not further', () => {
    expect(needsGuide(departure({ startsAt: inHours(14 * 24 - 1) }), NOW, DAYS)).toBe(true);
    expect(needsGuide(departure({ startsAt: inHours(14 * 24) }), NOW, DAYS)).toBe(false);
  });

  it('ignores a departure that already started', () => {
    expect(needsGuide(departure({ startsAt: inHours(-1) }), NOW, DAYS)).toBe(false);
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
    const { shown, hidden } = guidelessTray(departures, NOW, DAYS);

    // Assert
    expect(shown).toHaveLength(30);
    expect(hidden).toBe(1);
    expect(shown[0]?.startsAt).toBe(inHours(30));
  });
});

// Spec 0046: la ventana la configura el operador.
describe('needsGuide con la ventana configurada', () => {
  it('uses the configured horizon', () => {
    const inFiveDays = departure({ startsAt: inHours(5 * 24) });
    expect(needsGuide(inFiveDays, NOW, 3)).toBe(false);
    expect(needsGuide(inFiveDays, NOW, 30)).toBe(true);
  });

  it('keeps the horizon boundary exclusive', () => {
    expect(needsGuide(departure({ startsAt: inHours(72) }), NOW, 3)).toBe(false);
    expect(needsGuide(departure({ startsAt: inHours(71) }), NOW, 3)).toBe(true);
  });

  it('applies the horizon to the tray', () => {
    const near = departure({ startsAt: inHours(24) });
    const far = departure({ startsAt: inHours(10 * 24) });
    expect(guidelessTray([near, far], NOW, 3).shown).toEqual([near]);
    expect(guidelessTray([near, far], NOW, 14).shown).toEqual([near, far]);
  });
});
