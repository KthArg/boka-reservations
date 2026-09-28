import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { getOperatorIdentity } from '@/lib/operator/repository';
import { isOperatorIdentityComplete } from '@/lib/operator/types';
import { getTourPricing } from '@/lib/public/tours';
import { isTourBookable } from '@/lib/public/tour-bookable';

/**
 * La venta en línea abre solo con los datos del operador completos (spec 0034): el turista acepta
 * términos que identifican al vendedor, y un texto con huecos no es aceptable. Lo verifican las
 * acciones del checkout antes de crear cualquier hold, y la página para no mostrar el formulario.
 */
export async function isSalesEnabled(): Promise<boolean> {
  return isOperatorIdentityComplete(await getOperatorIdentity());
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
  return isTourBookable(instance.tours, await getTourPricing(instance.tour_id));
}
