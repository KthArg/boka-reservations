// Qué fotos de tours borrar del bucket (spec 0038). Lógica pura, sin Supabase, para probar los
// frenos: Storage no entra en los respaldos de la base y un borrado no se puede deshacer.

export type StoredObject = { name: string; createdAt: string };

export type CleanupPlan =
  | { action: 'delete'; names: string[] }
  | { action: 'abort'; reason: 'no-references' | 'too-many'; candidates: number };

/** Una foto recién subida puede estar en un formulario abierto: se espera una semana. */
export const ORPHAN_GRACE_DAYS = 7;
/** Más candidatos que esto en una corrida no es normal: se revisa a mano. */
export const MAX_DELETIONS_PER_RUN = 50;
/** Sin ninguna foto referenciada, más candidatos que esto huele a leer la base equivocada. */
export const MAX_DELETIONS_WITHOUT_REFERENCES = 5;

const MS_PER_DAY = 86_400_000;
/** Marcador que Supabase crea en carpetas vacías: no es una foto. */
const FOLDER_PLACEHOLDER = '.emptyFolderPlaceholder';

/** El nombre del archivo de una URL pública del bucket (el CHECK los deja todos en la raíz). */
function fileName(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  return path.slice(path.lastIndexOf('/') + 1);
}

export function planTourImageCleanup(
  objects: StoredObject[],
  coverImageUrls: string[],
  now: Date,
): CleanupPlan {
  const referenced = new Set(coverImageUrls.map(fileName));
  const graceLimit = now.getTime() - ORPHAN_GRACE_DAYS * MS_PER_DAY;

  const names = objects
    .filter((o) => o.name !== FOLDER_PLACEHOLDER)
    .filter((o) => !referenced.has(o.name))
    .filter((o) => new Date(o.createdAt).getTime() < graceLimit)
    .map((o) => o.name);

  if (referenced.size === 0 && names.length > MAX_DELETIONS_WITHOUT_REFERENCES) {
    return { action: 'abort', reason: 'no-references', candidates: names.length };
  }
  if (names.length > MAX_DELETIONS_PER_RUN) {
    return { action: 'abort', reason: 'too-many', candidates: names.length };
  }
  return { action: 'delete', names };
}
