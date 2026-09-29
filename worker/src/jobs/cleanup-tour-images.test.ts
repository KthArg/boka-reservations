import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({ env: {} }));

const { coverImageUrls, listObjects } = await import('./cleanup-tour-images.js');

type Item = { id: string | null; name: string; created_at: string | null };

function storageStub(pages: Item[][], failAt?: number): SupabaseClient {
  const list = vi.fn((_path: string, opts: { offset: number; limit: number }) => {
    const page = opts.offset / opts.limit;
    if (page === failAt) return Promise.resolve({ data: null, error: { message: 'boom' } });
    return Promise.resolve({ data: pages[page] ?? [], error: null });
  });
  return { storage: { from: () => ({ list }) } } as unknown as SupabaseClient;
}

function toursStub(rows: { cover_image_url: string }[], count: number | null, error = false) {
  const query = {
    select: () => query,
    not: () =>
      Promise.resolve({ data: error ? null : rows, error: error ? { message: 'x' } : null, count }),
  };
  return { from: () => query } as unknown as SupabaseClient;
}

const file = (i: number): Item => ({ id: `id-${i}`, name: `f${i}.jpg`, created_at: '2026-01-01' });

describe('listObjects', () => {
  it('recorre todas las páginas y descarta las carpetas', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => file(i));
    const last = [file(1000), { id: null, name: 'carpeta', created_at: null }];
    const objects = await listObjects(storageStub([full, last]));
    expect(objects).toHaveLength(1001);
  });

  it('si falla el listado, lanza y no devuelve nada a medias', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => file(i));
    await expect(listObjects(storageStub([full, []], 1))).rejects.toThrow('listar');
  });
});

describe('coverImageUrls', () => {
  it('devuelve las fotos en uso', async () => {
    const urls = await coverImageUrls(toursStub([{ cover_image_url: 'a' }], 1));
    expect(urls).toEqual(['a']);
  });

  it('si la lectura vino cortada, lanza', async () => {
    await expect(coverImageUrls(toursStub([{ cover_image_url: 'a' }], 2))).rejects.toThrow(
      'incompleta',
    );
  });

  it('si falla la lectura, lanza', async () => {
    await expect(coverImageUrls(toursStub([], null, true))).rejects.toThrow('tours');
  });
});
