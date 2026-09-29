import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import { planTourImageCleanup, type StoredObject } from './tour-image-cleanup-plan.js';

// Borra del bucket las fotos de tours que ningún tour usa (spec 0038): las reemplazadas, las que
// se quitaron y las de formularios abandonados. Una vez por día. Ante cualquier duda no borra: un
// error lanzado lo reporta index.ts a Sentry.

/** El bucket de las fotos (migración …050). El worker no importa @shared en runtime. */
const TOUR_IMAGES_BUCKET = 'tour-images';
const LIST_PAGE_SIZE = 1000;
const REMOVE_BATCH_SIZE = 100;

export async function listObjects(db: SupabaseClient): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await db.storage
      .from(TOUR_IMAGES_BUCKET)
      .list('', { limit: LIST_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`no se pudo listar el bucket: ${error.message}`);
    for (const item of data ?? []) {
      // Las carpetas vienen sin id ni fecha: no son fotos.
      if (item.id && item.created_at) objects.push({ name: item.name, createdAt: item.created_at });
    }
    if (!data || data.length < LIST_PAGE_SIZE) return objects;
  }
}

/**
 * Todas las fotos en uso. PostgREST corta en max-rows sin avisar: si faltaran filas, el job
 * borraría fotos en uso. Se compara con el total y, ante una diferencia, no se borra nada.
 */
export async function coverImageUrls(db: SupabaseClient): Promise<string[]> {
  const { data, error, count } = await db
    .from('tours')
    .select('cover_image_url', { count: 'exact' })
    .not('cover_image_url', 'is', null);
  if (error) throw new Error(`no se pudieron leer los tours: ${error.message}`);
  const rows = (data ?? []) as { cover_image_url: string }[];
  if (count !== null && rows.length !== count) {
    throw new Error(`lectura de tours incompleta (${rows.length} de ${count})`);
  }
  return rows.map((t) => t.cover_image_url);
}

export async function cleanupTourImages(now: Date = new Date()): Promise<void> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Primero el bucket y después los tours: una foto que se guarda entre las dos lecturas queda
  // referenciada y no se borra.
  const objects = await listObjects(db);
  const plan = planTourImageCleanup(objects, await coverImageUrls(db), now);

  if (plan.action === 'abort') {
    throw new Error(
      `[cleanup-tour-images] no se borró nada (${plan.reason}, ${plan.candidates} candidatas): revisar a mano`,
    );
  }

  for (let i = 0; i < plan.names.length; i += REMOVE_BATCH_SIZE) {
    const batch = plan.names.slice(i, i + REMOVE_BATCH_SIZE);
    const { error } = await db.storage.from(TOUR_IMAGES_BUCKET).remove(batch);
    if (error) throw new Error(`no se pudieron borrar fotos: ${error.message}`);
  }
  console.log(`[cleanup-tour-images] ${plan.names.length} fotos borradas`);
}
