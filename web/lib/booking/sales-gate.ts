import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { getOperatorIdentity } from '@/lib/operator/repository';
import { isOperatorIdentityComplete } from '@/lib/operator/types';
import { isTourBookable } from '@/lib/public/tour-bookable';
import { TicketType } from '@shared/constants/enums';

/**
 * La venta en línea abre solo con los datos del operador completos (spec 0034): el turista acepta
 * términos que identifican al vendedor, y un texto con huecos no es aceptable. Lo verifican las
 * acciones del checkout antes de crear cualquier hold, y la página para no mostrar el formulario.
 */
export async function isSalesEnabled(): Promise<boolean> {
  try {
    return isOperatorIdentityComplete(await getOperatorIdentity());
  } catch (err) {
    // Falla cerrada: sin poder leer la identidad no se vende, y el turista ve el aviso de venta
    // cerrada en lugar de un error de servidor.
    console.error('[sales-gate] no se pudo leer la identidad del operador:', err);
    return false;
  }
}

/**
 * La salida pertenece a un tour con la información que prometen los términos (spec 0034). Ante
 * cualquier error de lectura responde que no: la venta falla cerrada.
 */
export async function isInstanceSellable(instanceId: string): Promise<boolean> {
  const db = createSupabaseServiceClient();
  const { data: instance, error } = await db
    .from('tour_instances')
    .select(
      'tour_id, tours!inner(excludes_es, excludes_en, requirements_es, requirements_en, child_age_min, child_age_max)',
    )
    .eq('id', instanceId)
    .maybeSingle();
  if (error || !instance?.tours) return false;

  // Cualquier precio de niño, vigente o no, exige las edades: la lectura pública de precios se
  // traga los errores y, con una lista vacía, dejaría pasar un tour sin edades.
  const { data: childPricing, error: pricingError } = await db
    .from('tour_pricing')
    .select('ticket_type')
    .eq('tour_id', instance.tour_id)
    .eq('ticket_type', TicketType.Child)
    .limit(1);
  if (pricingError) return false;
  return isTourBookable(instance.tours, childPricing ?? []);
}
