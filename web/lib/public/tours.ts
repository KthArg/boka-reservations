import { createSupabasePublicClient } from '@/lib/db/supabase-public';
import { applyActivePricingFilter } from '@/lib/pricing/active-filter';
import { lowestChargedPrice, selectPriceForDay } from '@/lib/pricing/season';
import { InstanceStatus, TicketType, TourStatus } from '@shared/constants/enums';
import type { Tables } from '@/types/database';
import { crDate } from '@/lib/dates/cr-date';
import { shiftOfTour, type TourShift } from './shift';

export type PublicTour = Tables<'tours'>;
export type PublicPricing = Tables<'tour_pricing'>;
export type PublicInstance = Tables<'tour_instances'>;

export type TourWithMinPrice = PublicTour & {
  min_price_usd: number | null;
  /** Día, noche o ambos según sus horarios vigentes (spec 0042); null sin horarios. */
  shift: TourShift | null;
};

type PricingForSelection = {
  ticket_type: string;
  price_usd: number;
  season_start: string | null;
  season_end: string | null;
};

export async function listActiveTours(): Promise<TourWithMinPrice[]> {
  const db = createSupabasePublicClient();

  const { data: tours, error } = await db
    .from('tours')
    .select('*')
    .eq('status', TourStatus.Active)
    .order('name_es');

  if (error) throw new Error(`Error al cargar tours: ${error.message}`);
  if (!tours) return [];

  // "Desde $X" (spec 0040): el precio de adulto más bajo que se cobra en algún día del año.
  const base = db
    .from('tour_pricing')
    .select('tour_id, price_usd, ticket_type, season_start, season_end')
    .eq('ticket_type', TicketType.Adult);
  const [{ data: pricing }, startTimes] = await Promise.all([
    applyActivePricingFilter(base),
    listScheduleStartTimes(tours.map((t) => t.id)),
  ]);

  const byTour = new Map<string, PricingForSelection[]>();
  for (const p of (pricing ?? []) as (PricingForSelection & { tour_id: string })[]) {
    const rows = byTour.get(p.tour_id) ?? [];
    rows.push(p);
    byTour.set(p.tour_id, rows);
  }
  const priceByTour = new Map<string, number>();
  for (const [tourId, rows] of byTour) {
    const lowest = lowestChargedPrice(rows, TicketType.Adult);
    if (lowest !== null) priceByTour.set(tourId, lowest);
  }

  return tours.map((t) => ({
    ...t,
    min_price_usd: priceByTour.get(t.id) ?? null,
    shift: shiftOfTour(startTimes.get(t.id) ?? []),
  }));
}

/**
 * Horas de inicio de los horarios vigentes de cada tour (spec 0042 §5.3): activos (lo único que
 * anon puede leer) y sin vencer. Si la consulta falla, los tours se muestran sin turno.
 */
async function listScheduleStartTimes(tourIds: string[]): Promise<Map<string, string[]>> {
  const byTour = new Map<string, string[]>();
  if (tourIds.length === 0) return byTour;
  const db = createSupabasePublicClient();
  const { data, error } = await db
    .from('tour_schedules')
    .select('tour_id, start_time')
    .in('tour_id', tourIds)
    .eq('active', true)
    .or(`valid_until.is.null,valid_until.gte.${crDate()}`);
  if (error) {
    console.error('[tours] no se pudieron leer los horarios:', error.message);
    return byTour;
  }
  for (const row of data ?? []) {
    const times = byTour.get(row.tour_id) ?? [];
    times.push(row.start_time);
    byTour.set(row.tour_id, times);
  }
  return byTour;
}

/** Turno del tour para su página de detalle (spec 0042). */
export async function getTourShift(tourId: string): Promise<TourShift | null> {
  const startTimes = await listScheduleStartTimes([tourId]);
  return shiftOfTour(startTimes.get(tourId) ?? []);
}

export async function getTourBySlug(slug: string): Promise<PublicTour | null> {
  const db = createSupabasePublicClient();

  const { data, error } = await db
    .from('tours')
    .select('*')
    .eq('slug', slug)
    .eq('status', TourStatus.Active)
    .single();

  if (error) return null;
  return data;
}

/**
 * Todas las tarifas activas del tour (spec 0040): el precio base y cada temporada, para la lista
 * de precios de la página y para calcular el precio de cada día del calendario.
 */
export async function getTourPriceList(tourId: string): Promise<PublicPricing[]> {
  const db = createSupabasePublicClient();
  const base = db.from('tour_pricing').select('*').eq('tour_id', tourId);
  const { data, error } = await applyActivePricingFilter(base)
    .order('ticket_type')
    .order('season_start', { ascending: true, nullsFirst: true });
  // Falla cerrada (sin precios no se vende), pero queda registro: si no, se vería un checkout
  // vacío sin saber por qué.
  if (error) console.error('[tours] no se pudieron leer los precios:', error.message);
  return (data ?? []) as PublicPricing[];
}

/**
 * El precio de cada tiquete para un día de Costa Rica (spec 0040): la misma selección que el
 * cobro (checkout-pricing), así lo que ve el turista en el checkout es lo que se cobra.
 */
export async function getTourPricingForDay(
  tourId: string,
  crDay: string,
): Promise<PublicPricing[]> {
  return selectPriceForDay(await getTourPriceList(tourId), crDay);
}

const MS_PER_HOUR = 3_600_000;

/**
 * Salidas que todavía se pueden reservar en línea: disponibles y que empiezan después de la
 * anticipación mínima (spec 0041; con 0, después de ahora).
 */
export async function getUpcomingInstances(
  tourId: string,
  cutoffHours: number,
): Promise<PublicInstance[]> {
  const db = createSupabasePublicClient();

  // Solo salidas futuras fuera de la anticipación mínima (spec 0028 B7, spec 0041): el checkout
  // rechazaría las demás recién al pagar.
  const { data } = await db
    .from('tour_instances')
    .select('*')
    .eq('tour_id', tourId)
    .eq('status', InstanceStatus.Available)
    .gt('starts_at', new Date(Date.now() + cutoffHours * MS_PER_HOUR).toISOString())
    .order('starts_at');

  return data ?? [];
}

/**
 * Una salida del tour, disponible, que todavía no empezó pero ya está dentro de la anticipación
 * mínima (spec 0041): la página del checkout muestra el aviso de venta cerrada en vez de 404.
 */
export async function isClosedForOnlineBooking(
  tourId: string,
  instanceId: string,
  cutoffHours: number,
): Promise<boolean> {
  const db = createSupabasePublicClient();
  const { data, error } = await db
    .from('tour_instances')
    .select('starts_at')
    .eq('id', instanceId)
    .eq('tour_id', tourId)
    .eq('status', InstanceStatus.Available)
    .maybeSingle();
  if (error) {
    console.error('[tours] no se pudo leer la salida del checkout:', error.message);
    return false;
  }
  if (!data) return false;
  const startsAt = new Date(data.starts_at).getTime();
  const now = Date.now();
  return startsAt > now && startsAt <= now + cutoffHours * MS_PER_HOUR;
}
