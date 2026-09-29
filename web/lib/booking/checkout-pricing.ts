import type { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { applyActivePricingFilter, PRICING_SELECTION_COLUMNS } from '@/lib/pricing/active-filter';
import { selectPriceForDay, type PriceRow } from '@/lib/pricing/season';
import { crDate } from '@/lib/dates/cr-date';
import { computeAuthoritativeTotal } from '@/lib/booking/pricing-math';
import type { PricingRow } from '@/lib/booking/pricing-math';
import type { TicketQuantities } from '@/lib/booking/quantities';
import type { BookingLocale } from '@/lib/booking/create';

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type AuthoritativeCharge = {
  tourName: string;
  totalAmountCents: number;
};

interface InstanceTourRow {
  tour_id: string;
  starts_at: string;
  tours: { name_es: string; name_en: string } | null;
}

/**
 * Calcula, 100% server-side, el monto a cobrar y la descripción del cobro para una
 * instancia (spec 0015). El cliente no influye en ninguno de los dos. La existencia/estado
 * de la instancia la revalida `create_hold_atomic` aparte; acá solo se resuelve el tour
 * para el precio y se falla temprano si la instancia no existe.
 */
export async function resolveAuthoritativeCharge(
  db: ServiceClient,
  instanceId: string,
  quantities: TicketQuantities,
  locale: BookingLocale,
): Promise<AuthoritativeCharge> {
  const { data, error } = await db
    .from('tour_instances')
    .select('tour_id, starts_at, tours!inner(name_es, name_en)')
    .eq('id', instanceId)
    .single();

  const row = data as InstanceTourRow | null;
  if (error || !row || !row.tours) throw new Error('CHECKOUT_INSTANCE_NOT_FOUND');

  const tourName = locale === 'es' ? row.tours.name_es : row.tours.name_en;
  // Spec 0040: la temporada la decide el día de la salida en Costa Rica, no el de la compra.
  const pricing = await loadPricingForDay(db, row.tour_id, crDate(new Date(row.starts_at)));
  const totalAmountCents = computeAuthoritativeTotal(quantities, pricing);

  return { tourName, totalAmountCents };
}

async function loadPricingForDay(
  db: ServiceClient,
  tourId: string,
  crDay: string,
): Promise<PricingRow[]> {
  const base = db.from('tour_pricing').select(PRICING_SELECTION_COLUMNS).eq('tour_id', tourId);
  const { data, error } = await applyActivePricingFilter(base);
  if (error) throw new Error('CHECKOUT_PRICING_LOAD_FAILED');
  return selectPriceForDay((data ?? []) as (PricingRow & PriceRow)[], crDay);
}
