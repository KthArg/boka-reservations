import { describe, expect, it } from 'vitest';
import { toCalendarDepartures } from './calendar-departures';
import type { PublicInstance } from './tours';

// La conversión a Costa Rica no debe depender de la zona de la máquina: se prueba lejos de las dos.
process.env.TZ = 'Asia/Tokyo';

function instance(startsAt: string, total = 10, reserved = 0): PublicInstance {
  return {
    id: 'i-1',
    starts_at: startsAt,
    capacity_total: total,
    capacity_reserved: reserved,
  } as PublicInstance;
}

describe('toCalendarDepartures', () => {
  it('las 05:30 UTC del 1 de noviembre son las 23:30 del 31 de octubre en Costa Rica', () => {
    const [departure] = toCalendarDepartures([instance('2026-11-01T05:30:00Z')], 'en');
    expect(departure.crDay).toBe('2026-10-31');
    expect(departure.time).toBe('11:30 PM');
  });

  it('formatea la hora en el idioma de la página', () => {
    const [departure] = toCalendarDepartures([instance('2026-10-06T14:00:00Z')], 'es');
    expect(departure.crDay).toBe('2026-10-06');
    expect(departure.time).toMatch(/^8:00\sa\.\s?m\.$/);
  });

  it('una salida sobrerreservada queda con 0 lugares', () => {
    const [departure] = toCalendarDepartures([instance('2026-10-06T14:00:00Z', 10, 12)], 'es');
    expect(departure.seatsLeft).toBe(0);
  });
});
