// Job resolve-minimum (spec 0035): resuelve la ventana de 24 a 25 horas y alerta las salidas bajo
// el mínimo que llegaron a menos de 24 h sin resolver. La función SQL la cubren los tests de
// integración de la web (departure-cancellation.test.ts); acá se prueba qué pide el job y a quién.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ messages: [] as { message: string; fingerprint: string[] }[] }));
vi.mock('@sentry/node', () => {
  let fingerprint: string[] = [];
  return {
    captureMessage: (message: string) => sentry.messages.push({ message, fingerprint }),
    withScope: (callback: (scope: unknown) => void) => {
      fingerprint = [];
      callback({
        setLevel: () => undefined,
        setExtra: () => undefined,
        setFingerprint: (value: string[]) => {
          fingerprint = value;
        },
      });
    },
  };
});
vi.mock('../../src/env.js', () => ({ env: {} }));

const { MSG_MINIMUM_OVERDUE, resetOverdueAlertsForTest, runResolveMinimum } =
  await import('../../src/jobs/resolve-minimum.js');

const NOW = new Date('2026-10-01T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

type Filters = Record<string, unknown>;

/** Cliente mínimo: registra filtros por tabla y devuelve filas fijas. */
function fakeDb(rows: {
  due: { id: string }[];
  overdue: { id: string; capacity_reserved: number; tour: { min_participants: number } }[];
  deferred?: { tour_instance_id: string }[];
}) {
  const calls: { table: string; filters: Filters }[] = [];
  const rpc = vi.fn(() => Promise.resolve({ data: 'cancelled', error: null }));
  let instanceQueries = 0;

  function query(table: string) {
    const filters: Filters = {};
    const result = () => {
      if (table === 'bookings') return rows.deferred ?? [];
      instanceQueries += 1;
      return instanceQueries === 1 ? rows.due : rows.overdue;
    };
    const builder = {
      select: () => builder,
      neq: () => builder,
      is: () => builder,
      not: () => builder,
      in: () => builder,
      order: () => builder,
      gt: (column: string, value: string) => {
        filters[`gt:${column}`] = value;
        return builder;
      },
      lte: (column: string, value: string) => {
        filters[`lte:${column}`] = value;
        return builder;
      },
      limit: () => {
        calls.push({ table, filters });
        return Promise.resolve({ data: result(), error: null });
      },
      then: (resolve: (value: unknown) => void) => {
        calls.push({ table, filters });
        resolve({ data: result(), error: null });
      },
    };
    return builder;
  }

  return { db: { from: query, rpc } as never, rpc, calls };
}

beforeEach(() => {
  sentry.messages.length = 0;
  resetOverdueAlertsForTest();
});

describe('runResolveMinimum', () => {
  it('pide las salidas que empiezan entre 24 y 25 horas y resuelve cada una', async () => {
    const { db, rpc, calls } = fakeDb({ due: [{ id: 'a' }, { id: 'b' }], overdue: [] });

    await runResolveMinimum(db, NOW);

    expect(calls[0]!.filters).toEqual({
      'gt:starts_at': new Date(NOW.getTime() + 24 * HOUR_MS).toISOString(),
      'lte:starts_at': new Date(NOW.getTime() + 25 * HOUR_MS).toISOString(),
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('resolve_immediate_minimum', { p_instance_id: 'a' });
  });

  it('alerta una sola vez la salida atrasada bajo el mínimo', async () => {
    const overdue = [{ id: 'late', capacity_reserved: 1, tour: { min_participants: 4 } }];

    await runResolveMinimum(fakeDb({ due: [], overdue }).db, NOW);
    await runResolveMinimum(fakeDb({ due: [], overdue }).db, NOW);

    expect(sentry.messages).toEqual([
      { message: MSG_MINIMUM_OVERDUE, fingerprint: ['resolve-minimum-overdue', 'late'] },
    ]);
  });

  it('no alerta las que llegan al mínimo, las de mínimo 1 ni las del cobro diferido', async () => {
    const overdue = [
      { id: 'full', capacity_reserved: 4, tour: { min_participants: 4 } },
      { id: 'one', capacity_reserved: 0, tour: { min_participants: 1 } },
      { id: 'deferred', capacity_reserved: 0, tour: { min_participants: 4 } },
    ];

    await runResolveMinimum(
      fakeDb({ due: [], overdue, deferred: [{ tour_instance_id: 'deferred' }] }).db,
      NOW,
    );

    expect(sentry.messages).toEqual([]);
  });
});
