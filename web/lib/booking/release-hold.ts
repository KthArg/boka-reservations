import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { BookingStatus, HoldStatus } from '@shared/constants/enums';

/**
 * Libera el hold de una reserva `pending_payment` si el token de sesión demuestra
 * propiedad (ACCESS-03, spec 0023). Extraído de la página de cancelación de checkout
 * (spec 0028, B6): la lógica de negocio no vive en la page, las escrituras chequean
 * error y los estados usan constantes. Idempotente: el UPDATE condicional solo toca
 * holds `active`; repetir la llamada (reintentos, prefetch del GET) es inocuo.
 *
 * Tradeoff documentado: el caller sigue siendo un Server Component en GET (el widget
 * de OnvoPay redirige por GET, no hay POST posible); la cookie + la idempotencia
 * acotan el efecto.
 */
export async function releaseHeldBooking(bookingId: string, sessionToken: string): Promise<void> {
  const db = createSupabaseServiceClient();

  const { data: booking, error } = await db
    .from('bookings')
    .select('hold_id, status')
    .eq('id', bookingId)
    .maybeSingle();
  if (error || !booking?.hold_id || booking.status !== BookingStatus.PendingPayment) return;

  const { data: hold, error: holdErr } = await db
    .from('tour_holds')
    .select('session_token')
    .eq('id', booking.hold_id)
    .maybeSingle();
  if (holdErr || hold?.session_token !== sessionToken) return;

  const { error: updErr } = await db
    .from('tour_holds')
    .update({ status: HoldStatus.Released })
    .eq('id', booking.hold_id)
    .eq('status', HoldStatus.Active);
  if (updErr) console.error('[release-hold] update falló:', updErr.message);
}
