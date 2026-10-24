import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { DEFERRED_MAX_LIVE_SEATS_PER_IDENTITY } from '@shared/constants/bookings';
import { HoldStatus } from '@shared/constants/enums';
import { alertHoldNotReleasedOverCap } from './deferred-checkout-alerts';

// Tope de cupos vivos por persona del checkout diferido (spec 0048 §5.1). La regla autoritativa
// vive en create_deferred_booking (…063); acá solo el chequeo temprano y la liberación del hold.

/**
 * Paso 1: ¿con estos asientos el email ya pasa el tope? Es solo para no apartar ni crear el
 * customer en vano: si la consulta falla, se sigue y el paso 2 decide.
 */
export async function emailOverDeferredCap(email: string, seats: number): Promise<boolean> {
  const { data, error } = await createSupabaseServiceClient().rpc('deferred_live_seats_for_email', {
    p_email: email,
  });
  if (error) {
    console.error('[deferred-checkout] cap check:', error.message);
    return false;
  }
  return (data ?? 0) + seats > DEFERRED_MAX_LIVE_SEATS_PER_IDENTITY;
}

/**
 * Paso 2 rechazado por el tope: el apartado vuelve a estar disponible enseguida. Solo un hold
 * `active` de esta sesión; nunca releaseHold, que también suelta holds `paying` y abriría
 * sobreventa si otro paso 2 de la misma sesión ya creó la reserva. El customer de OnvoPay lo
 * limpia close-payment-intents, que toma los holds `released`.
 */
export async function releaseHoldOverCap(holdId: string, sessionToken: string): Promise<void> {
  const { error } = await createSupabaseServiceClient()
    .from('tour_holds')
    .update({ status: HoldStatus.Released })
    .eq('id', holdId)
    .eq('session_token', sessionToken)
    .eq('status', HoldStatus.Active);
  if (error) {
    console.error('[deferred-checkout] release over cap:', error.message);
    alertHoldNotReleasedOverCap(holdId);
  }
}
