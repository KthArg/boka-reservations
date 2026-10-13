import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { writeAuditLog } from '@/lib/audit/log';
import { crDate } from '@/lib/dates/cr-date';
import { applyActivePricingFilter } from '@/lib/pricing/active-filter';
import { lowestChargedPrice } from '@/lib/pricing/season';
import { isTourBookable } from '@/lib/public/tour-bookable';
import { AuditAction, AuditActorType, AuditEntityType } from '@shared/constants/audit';
import { TicketType, TourStatus } from '@shared/constants/enums';
import { TourActionError } from '@shared/constants/tours';

// Pausa y reanudación de la venta de un tour (spec 0047 §5.2 y §5.3). Por id, para que los tests
// las ejerciten con tours desechables; las acciones del panel resuelven el id desde el `kind`.

type ServiceClient = SupabaseClient<Database>;

export type TourStatusResult = { ok: true } | { ok: false; error: string };

/**
 * Cambia el estado solo si el tour está en el de origen: dos admins a la vez no duplican la
 * auditoría, y el segundo recibe el mismo "ok" porque el tour ya quedó como pidió. También
 * responde "ok" sin cambiar nada si el tour no existe o está archivado: quien llama resuelve
 * antes el tour fijo por su `kind`.
 */
async function transition(
  db: ServiceClient,
  tourId: string,
  actorId: string,
  from: TourStatus,
  to: TourStatus,
): Promise<TourStatusResult> {
  const { data, error } = await db
    .from('tours')
    .update({ status: to })
    .eq('id', tourId)
    .eq('status', from)
    .select('id');
  if (error) return { ok: false, error: TourActionError.StatusChangeFailed };
  if ((data?.length ?? 0) === 0) return { ok: true };

  await writeAuditLog(db, {
    actorType: AuditActorType.Admin,
    actorId,
    action: to === TourStatus.Paused ? AuditAction.TourPaused : AuditAction.TourResumed,
    entityType: AuditEntityType.Tour,
    entityId: tourId,
  });
  return { ok: true };
}

/** Pausar no tiene precondiciones: las reservas existentes siguen su ciclo. */
export function pauseTourById(
  db: ServiceClient,
  tourId: string,
  actorId: string,
): Promise<TourStatusResult> {
  return transition(db, tourId, actorId, TourStatus.Active, TourStatus.Paused);
}

/**
 * Qué le falta al tour para venderse, con el mismo criterio que el sitio: la ficha que prometen
 * los términos, un horario vigente y un precio de adulto. Ante un error de lectura responde que
 * falta: reanudar falla cerrado.
 */
async function missingToSell(db: ServiceClient, tourId: string): Promise<string | null> {
  const pricingQuery = db
    .from('tour_pricing')
    .select('ticket_type, price_usd, season_start, season_end')
    .eq('tour_id', tourId);
  const [tour, schedules, pricing] = await Promise.all([
    db
      .from('tours')
      .select(
        'excludes_es, excludes_en, requirements_es, requirements_en, child_age_min, child_age_max',
      )
      .eq('id', tourId)
      .maybeSingle(),
    db
      .from('tour_schedules')
      .select('id')
      .eq('tour_id', tourId)
      .eq('active', true)
      .or(`valid_until.is.null,valid_until.gte.${crDate()}`)
      .limit(1),
    applyActivePricingFilter(pricingQuery),
  ]);
  if (tour.error || !tour.data || schedules.error || pricing.error) {
    return TourActionError.StatusChangeFailed;
  }
  const rows = pricing.data ?? [];
  if (!isTourBookable(tour.data, rows)) return TourActionError.ResumeMissingInfo;
  if ((schedules.data?.length ?? 0) === 0) return TourActionError.ResumeMissingSchedule;
  if (lowestChargedPrice(rows, TicketType.Adult) === null) {
    return TourActionError.ResumeMissingPrice;
  }
  return null;
}

export async function resumeTourById(
  db: ServiceClient,
  tourId: string,
  actorId: string,
): Promise<TourStatusResult> {
  // Una pestaña vieja puede pedir reanudar un tour que ya está en venta: no hay nada que exigir.
  const { data: tour, error } = await db
    .from('tours')
    .select('status')
    .eq('id', tourId)
    .maybeSingle();
  if (error) return { ok: false, error: TourActionError.StatusChangeFailed };
  if (tour?.status !== TourStatus.Paused) return { ok: true };

  const missing = await missingToSell(db, tourId);
  if (missing) return { ok: false, error: missing };
  return transition(db, tourId, actorId, TourStatus.Paused, TourStatus.Active);
}
