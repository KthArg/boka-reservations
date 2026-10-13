// Lecturas públicas de los dos tours fijos (spec 0047 §5.4), con el cliente anon real: la portada
// los devuelve siempre día y después noche, con su precio "desde", estén en venta o en pausa.
// Requiere: supabase start + seed. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { getFixedTour, listFixedTours } from '@/lib/public/tours';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const service = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function setNightStatus(status: 'active' | 'paused'): Promise<void> {
  const { error } = await service.from('tours').update({ status }).eq('kind', 'night');
  if (error) throw new Error(`setNightStatus: ${error.message}`);
}

afterAll(async () => {
  await setNightStatus('active');
});

describe('listFixedTours', () => {
  it('returns the day tour first and the night tour second, each with its lowest adult price', async () => {
    // Act
    const tours = await listFixedTours();

    // Assert: precios de adulto del seed, 55 y 65 el diurno, 70 y 80 el nocturno.
    expect(tours.map((t) => t.kind)).toEqual(['day', 'night']);
    expect(tours.map((t) => t.min_price_usd)).toEqual([55, 70]);
  });

  it('still lists a paused tour, so the site can show its notice', async () => {
    // Arrange
    await setNightStatus('paused');

    // Act
    const tours = await listFixedTours();

    // Assert
    expect(tours.map((t) => [t.kind, t.status])).toEqual([
      ['day', 'active'],
      ['night', 'paused'],
    ]);
    await setNightStatus('active');
  });
});

describe('getFixedTour', () => {
  it('finds each fixed tour by its kind', async () => {
    // Act
    const [day, night] = await Promise.all([getFixedTour('day'), getFixedTour('night')]);

    // Assert
    expect(day?.kind).toBe('day');
    expect(night?.kind).toBe('night');
  });
});
