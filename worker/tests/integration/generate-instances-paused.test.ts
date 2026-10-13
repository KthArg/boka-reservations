// Job generate-tour-instances y la pausa de un tour (spec 0047 §5.2): un tour en pausa no genera
// salidas nuevas, y al reanudarlo la corrida siguiente genera las que faltan. Contra DB real.
// Requiere: supabase start.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDeparture, db, deleteDepartures, must, ok } from './deferred-fixtures.js';

vi.mock('../../src/env.js', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    APP_URL: 'http://localhost:3000',
  },
}));

const { generateTourInstances } = await import('../../src/jobs/generate-tour-instances.js');

const DAY_MS = 86_400_000;
let tourId: string;
let seededInstanceId: string;

/** Salidas del tour que creó el job (todas menos la que sembró el fixture). */
async function generatedCount(): Promise<number> {
  const rows = must(
    await db.from('tour_instances').select('id').eq('tour_id', tourId).neq('id', seededInstanceId),
    'instances',
  );
  return rows.length;
}

beforeAll(async () => {
  // El fixture deja un horario semanal activo; el job genera a partir de él.
  const departure = await createDeparture(200 * DAY_MS);
  tourId = departure.tourId;
  seededInstanceId = departure.instanceId;
});

afterAll(async () => {
  await deleteDepartures([tourId]);
});

describe('generateTourInstances — tour en pausa', () => {
  it('generates nothing for a paused tour and catches up once it is resumed', async () => {
    // Arrange
    ok(await db.from('tours').update({ status: 'paused' }).eq('id', tourId), 'pause');

    // Act
    await generateTourInstances();
    const whilePaused = await generatedCount();
    ok(await db.from('tours').update({ status: 'active' }).eq('id', tourId), 'resume');
    await generateTourInstances();

    // Assert
    expect(whilePaused).toBe(0);
    expect(await generatedCount()).toBeGreaterThan(0);
  });
});
