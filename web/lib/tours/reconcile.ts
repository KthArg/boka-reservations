import type { createSupabaseServerClient } from '@/lib/db/supabase-server';
import {
  PG_EXCLUSION_VIOLATION,
  PG_FK_VIOLATION,
  PG_UNIQUE_VIOLATION,
  TourActionError,
} from '@shared/constants/tours';

// Reconciliación de filas hijas de un tour (spec 0028, B1): el formulario representa el
// estado FINAL completo, así que (1) se eliminan de DB las filas que ya no vienen en el
// form y (2) se upsertean las presentes — TODO con chequeo de error. Antes, quitar un
// precio no lo eliminaba y un upsert fallido redirigía como si hubiera guardado (el
// checkout seguía cobrando el precio viejo en silencio).

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type WriteRow = Record<string, unknown> & { id?: string };
type PgError = { code?: string; message?: string };

const BASE_UNIQUE_INDEX = 'tour_pricing_one_base_per_type';
/** Texto del error del trigger de superposición de temporadas (…052, spec 0040). */
const OVERLAP_CONSTRAINT = 'tour_pricing_season_overlap';

/** Mapea la violación del índice del precio base o del trigger de temporadas a su código. */
export function writeErrorCode(error: PgError, fallback: string): string {
  if (error.code === PG_UNIQUE_VIOLATION && error.message?.includes(BASE_UNIQUE_INDEX)) {
    return TourActionError.BasePriceDuplicate;
  }
  if (error.code === PG_EXCLUSION_VIOLATION && error.message?.includes(OVERLAP_CONSTRAINT)) {
    return TourActionError.PricingOverlap;
  }
  return fallback;
}

/**
 * Borra las filas del tour ausentes del form y upsertea las presentes.
 * Devuelve el código de error de dominio, o null si todo se escribió.
 */
export async function reconcileRows(
  db: ServerClient,
  table: 'tour_pricing' | 'tour_schedules',
  tourId: string,
  rows: WriteRow[],
  fallback: string,
): Promise<string | null> {
  const keepIds = rows.map((r) => r.id).filter((id): id is string => typeof id === 'string');

  let deletion = db.from(table).delete().eq('tour_id', tourId);
  if (keepIds.length > 0) deletion = deletion.not('id', 'in', `(${keepIds.join(',')})`);
  const { error: delError } = await deletion;
  if (delError) {
    // Un horario con salidas ya generadas no puede eliminarse (FK): desactivarlo.
    return (delError as PgError).code === PG_FK_VIOLATION
      ? TourActionError.ScheduleInUse
      : fallback;
  }

  if (rows.length > 0) {
    // El payload viene de mapPricing/mapSchedules (tipado por tabla); el genérico sobre
    // `table` no deja expresar la unión al builder — cast puntual, mismo criterio que
    // FilterBuilder en lib/booking/repository.ts.
    // defaultToNull: false — al mezclar filas existentes (con id) y nuevas (sin id), supabase-js
    // arma las columnas con la unión de claves y mandaba id: null en las nuevas (NOT NULL del PK):
    // editar un tour y agregarle un horario o un precio fallaba. Así la base usa el DEFAULT.
    const { error } = await db.from(table).upsert(rows as never, { defaultToNull: false });
    if (error) return writeErrorCode(error as PgError, fallback);
  }
  return null;
}
