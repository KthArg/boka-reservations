import { createSupabasePublicClient } from '@/lib/db/supabase-public';
import {
  applyActivePricingFilter,
  pricingToday,
  selectEffectivePricing,
} from '@/lib/pricing/active-filter';
import { InstanceStatus, TicketType, TourStatus } from '@shared/constants/enums';
import type { Tables } from '@/types/database';

export type PublicTour = Tables<'tours'>;
export type PublicPricing = Tables<'tour_pricing'>;
export type PublicInstance = Tables<'tour_instances'>;

export type TourWithMinPrice = PublicTour & { min_price_usd: number | null };

export async function listActiveTours(): Promise<TourWithMinPrice[]> {
  const db = createSupabasePublicClient();

  const { data: tours, error } = await db
    .from('tours')
    .select('*')
    .eq('status', TourStatus.Active)
    .order('name_es');

  if (error) throw new Error(`Error al cargar tours: ${error.message}`);
  if (!tours) return [];

  // Mismo filtro canónico que checkout/detalle (día CR) + prioridad temporada>base
  // (spec 0028): el "desde $X" del listado es el precio adulto EFECTIVO de hoy.
  const base = db
    .from('tour_pricing')
    .select('tour_id, price_usd, ticket_type, valid_from, valid_until')
    .eq('ticket_type', TicketType.Adult);
  const { data: pricing } = await applyActivePricingFilter(base, pricingToday());

  const byTour = new Map<string, (typeof pricing)[number][]>();
  for (const p of (pricing ?? []) as {
    tour_id: string;
    ticket_type: string;
    price_usd: number;
    valid_from: string | null;
    valid_until: string | null;
  }[]) {
    const rows = byTour.get(p.tour_id) ?? [];
    rows.push(p);
    byTour.set(p.tour_id, rows);
  }
  const priceByTour = new Map<string, number>();
  for (const [tourId, rows] of byTour) {
    const effective = selectEffectivePricing(rows)[0];
    if (effective) priceByTour.set(tourId, effective.price_usd);
  }

  return tours.map((t) => ({
    ...t,
    min_price_usd: priceByTour.get(t.id) ?? null,
  }));
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

export async function getTourPricing(tourId: string): Promise<PublicPricing[]> {
  const db = createSupabasePublicClient();
  const base = db.from('tour_pricing').select('*').eq('tour_id', tourId);

  const { data } = await applyActivePricingFilter(base).order('ticket_type');

  // Prioridad temporada>base (spec 0028): el display usa la MISMA selección que el
  // cobro (checkout-pricing) — lo mostrado es siempre lo cobrado.
  return selectEffectivePricing((data ?? []) as PublicPricing[]);
}

export async function getUpcomingInstances(tourId: string): Promise<PublicInstance[]> {
  const db = createSupabasePublicClient();

  // starts_at >= ahora (spec 0028, B7): una salida ya pasada que siga `available`
  // no debe ofrecerse — el checkout la rechazaría (HOLD_INSTANCE_PAST) recién al pagar.
  const { data } = await db
    .from('tour_instances')
    .select('*')
    .eq('tour_id', tourId)
    .eq('status', InstanceStatus.Available)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at');

  return data ?? [];
}
