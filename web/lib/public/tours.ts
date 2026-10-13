import { createSupabasePublicClient } from '@/lib/db/supabase-public';
import { captureAlert } from '@/lib/booking/sentry-alert';
import { applyActivePricingFilter } from '@/lib/pricing/active-filter';
import { lowestChargedPrice, selectPriceForDay } from '@/lib/pricing/season';
import { InstanceStatus, TicketType, TOUR_KINDS, type TourKind } from '@shared/constants/enums';
import type { Tables } from '@/types/database';

export type PublicTour = Tables<'tours'>;
export type PublicPricing = Tables<'tour_pricing'>;
export type PublicInstance = Tables<'tour_instances'>;

/** Un tour fijo para la portada (spec 0047): con su precio "desde", o null si no tiene precio. */
export type FixedTour = PublicTour & { kind: TourKind; min_price_usd: number | null };

type PricingForSelection = {
  tour_id: string;
  ticket_type: string;
  price_usd: number;
  season_start: string | null;
  season_end: string | null;
};

/**
 * Los dos tours fijos, siempre día y después noche, estén en venta o en pausa (la RLS de anon
 * oculta los archivados). Una fila faltante es una base mal sembrada: se muestra la que haya.
 */
export async function listFixedTours(): Promise<FixedTour[]> {
  const db = createSupabasePublicClient();

  const { data, error } = await db.from('tours').select('*').not('kind', 'is', null);
  if (error) throw new Error(`Error al cargar tours: ${error.message}`);
  const tours = (data ?? []).filter((t): t is PublicTour & { kind: TourKind } => t.kind !== null);
  if (tours.length < TOUR_KINDS.length) {
    captureAlert('Falta un tour fijo en la base', 'fixed-tour-missing', {
      found: String(tours.length),
    });
  }
  if (tours.length === 0) return [];

  // "Desde $X" (spec 0040): el precio de adulto más bajo que se cobra en algún día del año.
  const base = db
    .from('tour_pricing')
    .select('tour_id, price_usd, ticket_type, season_start, season_end')
    .in(
      'tour_id',
      tours.map((t) => t.id),
    )
    .eq('ticket_type', TicketType.Adult);
  const { data: pricing, error: pricingError } = await applyActivePricingFilter(base);
  // Sin precios la portada muestra "consultar precio"; que quede registro de por qué.
  if (pricingError) console.error('[tours] no se pudieron leer los precios:', pricingError.message);
  const rows = (pricing ?? []) as PricingForSelection[];

  return TOUR_KINDS.flatMap((kind) => {
    const tour = tours.find((t) => t.kind === kind);
    if (!tour) return [];
    const own = rows.filter((row) => row.tour_id === tour.id);
    return [{ ...tour, min_price_usd: lowestChargedPrice(own, TicketType.Adult) }];
  });
}

/** Un tour fijo por su `kind`, en venta o en pausa; quien lo use decide qué mostrar en pausa. */
export async function getFixedTour(kind: TourKind): Promise<PublicTour | null> {
  const db = createSupabasePublicClient();
  const { data, error } = await db.from('tours').select('*').eq('kind', kind).maybeSingle();
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
