// PRIV-05 (spec 0023): el export CSV de reservas (PII masiva) deja traza en audit_logs.
// Mockea la autorización (requireAnyRole) y el repo de export; usa el service client REAL para
// verificar que el route handler inserta un audit_logs `booking.export` con actor y rango.
// Requiere: supabase start. Ejecutar: pnpm test:integration

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — load .env.local');

const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

// Holder hoisted para inyectar el id del admin real (FK audit_logs.actor_id → users).
const h = vi.hoisted(() => ({ adminUserId: '' }));

vi.mock('@/lib/auth/server', () => ({
  requireAnyRole: vi.fn(async () => ({ id: h.adminUserId, userRole: 'admin' })),
}));
// No tocar la DB de reservas reales para armar el CSV; el conteo (0) basta para el audit.
vi.mock('@/lib/booking/export-repository', () => ({
  listBookingsForExport: vi.fn(async () => []),
}));

const { GET } = await import('@/app/[locale]/(admin)/dashboard/bookings/export/route');

beforeAll(async () => {
  const { data } = await admin
    .from('users')
    .select('id')
    .eq('email', 'admin@bokatrails.com')
    .single();
  h.adminUserId = data!.id;
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('export de reservas — auditoría PRIV-05', () => {
  it('inserta un audit_logs booking.export con actor y rango al exportar', async () => {
    const from = '2026-01-01';
    const to = '2026-01-31';
    const res = await GET(
      new Request(`http://localhost/es/dashboard/bookings/export?dateFrom=${from}&dateTo=${to}`),
    );
    expect(res.status).toBe(200);

    const { data: rows } = await admin
      .from('audit_logs')
      .select('actor_type, actor_id, entity_type, metadata, created_at')
      .eq('action', 'booking.export')
      .eq('actor_id', h.adminUserId)
      .order('created_at', { ascending: false })
      .limit(1);

    expect(rows ?? []).toHaveLength(1);
    const row = rows![0];
    expect(row.actor_type).toBe('admin');
    expect(row.entity_type).toBe('export');
    expect(row.metadata).toMatchObject({ from, to, count: 0 });
  });
});
