import { describe, expect, it } from 'vitest';
import {
  MAX_DELETIONS_PER_RUN,
  planTourImageCleanup,
  type StoredObject,
} from './tour-image-cleanup-plan.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const OLD = '2026-10-01T00:00:00.000Z';
const RECENT = '2026-10-18T00:00:00.000Z';
const BASE = 'https://proj.supabase.co/storage/v1/object/public/tour-images/';

function object(name: string, createdAt = OLD): StoredObject {
  return { name, createdAt };
}

describe('planTourImageCleanup', () => {
  it('borra solo las fotos que ningún tour usa y tienen más de 7 días', () => {
    const plan = planTourImageCleanup(
      [object('usada.jpg'), object('huerfana.jpg'), object('nueva.jpg', RECENT)],
      [`${BASE}usada.jpg`],
      NOW,
    );
    expect(plan).toEqual({ action: 'delete', names: ['huerfana.jpg'] });
  });

  it('una foto que usan dos tours (o un tour archivado) no se borra', () => {
    const plan = planTourImageCleanup(
      [object('compartida.jpg')],
      [`${BASE}compartida.jpg`, `${BASE}compartida.jpg`],
      NOW,
    );
    expect(plan).toEqual({ action: 'delete', names: [] });
  });

  it('ignora el marcador de carpeta vacía', () => {
    const plan = planTourImageCleanup([object('.emptyFolderPlaceholder')], [], NOW);
    expect(plan).toEqual({ action: 'delete', names: [] });
  });

  it('sin ninguna foto referenciada y varios candidatos, no borra nada', () => {
    const objects = Array.from({ length: 6 }, (_, i) => object(`f${i}.jpg`));
    expect(planTourImageCleanup(objects, [], NOW)).toEqual({
      action: 'abort',
      reason: 'no-references',
      candidates: 6,
    });
  });

  it('con demasiados candidatos, no borra nada', () => {
    const objects = Array.from({ length: MAX_DELETIONS_PER_RUN + 1 }, (_, i) =>
      object(`f${i}.jpg`),
    );
    const plan = planTourImageCleanup(objects, [`${BASE}otra.jpg`], NOW);
    expect(plan).toMatchObject({ action: 'abort', reason: 'too-many' });
  });
});
