import { describe, expect, it } from 'vitest';
import { shiftOfTime, shiftOfTour } from './shift';

describe('shiftOfTime', () => {
  it.each([
    ['04:59', 'night'],
    ['05:00', 'day'],
    ['08:00:00', 'day'],
    ['16:59', 'day'],
    ['17:00', 'night'],
    ['17:30:00', 'night'],
    ['23:59', 'night'],
    ['00:00', 'night'],
  ])('%s es %s', (time, expected) => {
    expect(shiftOfTime(time)).toBe(expected);
  });
});

describe('shiftOfTour', () => {
  it('sin horarios no hay turno', () => {
    expect(shiftOfTour([])).toBeNull();
  });

  it('solo horarios de mañana y tarde es de día', () => {
    expect(shiftOfTour(['08:00:00', '13:00:00'])).toBe('day');
  });

  it('solo horarios desde las 17:00 es de noche', () => {
    expect(shiftOfTour(['17:30:00', '19:00:00'])).toBe('night');
  });

  it('horarios de los dos turnos es día y noche', () => {
    expect(shiftOfTour(['08:00:00', '17:30:00'])).toBe('both');
  });
});
