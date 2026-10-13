import { describe, expect, it } from 'vitest';
import { shiftOfDeparture, shiftOfTime } from './shift';

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

describe('shiftOfDeparture', () => {
  it('una salida de un tour fijo tiene el turno del tour, a cualquier hora', () => {
    expect(shiftOfDeparture('day', '18:00')).toBe('day');
    expect(shiftOfDeparture('night', '06:00')).toBe('night');
  });

  it('una salida de un tour viejo, sin kind, se decide por la hora', () => {
    expect(shiftOfDeparture(null, '18:00')).toBe('night');
    expect(shiftOfDeparture(null, '06:00')).toBe('day');
  });
});
