import { describe, it, expect } from 'vitest';
import { parseTicketQuantities, MAX_TICKETS_PER_BOOKING } from './quantities';

describe('parseTicketQuantities', () => {
  it('acepta cantidades válidas (strings del formulario)', () => {
    expect(parseTicketQuantities({ adult: '2', child: '1', student: '0' })).toEqual({
      adult: 2,
      child: 1,
      student: 0,
    });
  });

  it('trata un campo ausente (null) como 0', () => {
    expect(parseTicketQuantities({ adult: '1', child: null, student: null })).toEqual({
      adult: 1,
      child: 0,
      student: 0,
    });
  });

  it('acepta el total exactamente en el tope', () => {
    const result = parseTicketQuantities({ adult: '6', child: '4', student: '0' });
    expect(result).not.toBeNull();
    expect(result!.adult + result!.child + result!.student).toBe(MAX_TICKETS_PER_BOOKING);
  });

  it('rechaza total 0 (todas las cantidades en 0)', () => {
    expect(parseTicketQuantities({ adult: '0', child: '0', student: '0' })).toBeNull();
  });

  it('rechaza un total por encima del tope', () => {
    expect(parseTicketQuantities({ adult: '6', child: '5', student: '0' })).toBeNull();
  });

  it('rechaza una cantidad individual por encima del tope', () => {
    expect(parseTicketQuantities({ adult: '11', child: '0', student: '0' })).toBeNull();
  });

  it('rechaza cantidades negativas', () => {
    expect(parseTicketQuantities({ adult: '-1', child: '0', student: '0' })).toBeNull();
  });

  it('rechaza valores no numéricos', () => {
    expect(parseTicketQuantities({ adult: 'abc', child: '0', student: '0' })).toBeNull();
  });

  it('rechaza cantidades decimales', () => {
    expect(parseTicketQuantities({ adult: '2.5', child: '0', student: '0' })).toBeNull();
  });
});
