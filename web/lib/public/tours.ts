import { createSupabasePublicClient } from '@/lib/db/supabase-public';
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
    .eq('status', 'active')
    .order('name_es');

  if (error) throw new Error(`Error al cargar tours: ${error.message}`);
  if (!tours) return [];

  const today = new Date().toISOString().slice(0, 10);
  const { data: pricing } = await db
    .from('tour_pricing')
    .select('tour_id, price_usd, ticket_type, active')
    .eq('ticket_type', 'adult')
    .eq('active', true)
    .or(`valid_from.is.null,and(valid_from.lte.${today},valid_until.gte.${today})`);

  const priceByTour = new Map<string, number>();
  for (const p of pricing ?? []) {
    const current = priceByTour.get(p.tour_id);
    if (current === undefined || p.price_usd < current) {
      priceByTour.set(p.tour_id, p.price_usd);
    }
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
    .eq('status', 'active')
    .single();

  if (error) return null;
  return data;
}

export async function getTourPricing(tourId: string): Promise<PublicPricing[]> {
  const db = createSupabasePublicClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data } = await db
    .from('tour_pricing')
    .select('*')
    .eq('tour_id', tourId)
    .eq('active', true)
    .or(`valid_from.is.null,and(valid_from.lte.${today},valid_until.gte.${today})`)
    .order('ticket_type');

  return data ?? [];
}

export async function getUpcomingInstances(tourId: string): Promise<PublicInstance[]> {
  const db = createSupabasePublicClient();

  const { data } = await db
    .from('tour_instances')
    .select('*')
    .eq('tour_id', tourId)
    .eq('status', 'available')
    .order('starts_at');

  return data ?? [];
}
