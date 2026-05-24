import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import type { TourListItem, TourWithDetails } from './types';

export async function listTours(): Promise<TourListItem[]> {
  const supabase = await createSupabaseServerClient();

  const [toursResult, schedulesResult] = await Promise.all([
    supabase.from('tours').select('*').order('created_at', { ascending: false }),
    supabase.from('tour_schedules').select('tour_id').eq('active', true),
  ]);

  if (toursResult.error) throw toursResult.error;
  if (schedulesResult.error) throw schedulesResult.error;

  const countByTourId = new Map<string, number>();
  for (const row of schedulesResult.data) {
    countByTourId.set(row.tour_id, (countByTourId.get(row.tour_id) ?? 0) + 1);
  }

  return toursResult.data.map((tour) => ({
    ...tour,
    activeSchedulesCount: countByTourId.get(tour.id) ?? 0,
  }));
}

export async function getTourWithDetails(id: string): Promise<TourWithDetails | null> {
  const supabase = await createSupabaseServerClient();

  const { data: tour, error } = await supabase.from('tours').select('*').eq('id', id).single();
  if (error || !tour) return null;

  const [pricingResult, schedulesResult] = await Promise.all([
    supabase.from('tour_pricing').select('*').eq('tour_id', id).order('created_at'),
    supabase
      .from('tour_schedules')
      .select('*')
      .eq('tour_id', id)
      .order('day_of_week')
      .order('start_time'),
  ]);

  if (pricingResult.error) throw pricingResult.error;
  if (schedulesResult.error) throw schedulesResult.error;

  return { ...tour, pricing: pricingResult.data, schedules: schedulesResult.data };
}

export async function slugExists(slug: string, excludeId?: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from('tours').select('id').eq('slug', slug);
  if (excludeId) query = query.neq('id', excludeId);
  const { data } = await query.maybeSingle();
  return data !== null;
}
