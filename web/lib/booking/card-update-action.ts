'use server';

import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { validateBookingToken } from '@/lib/booking/access-token';
import { PAYMENT_METHOD_ID_PATTERN } from '@/lib/payments/payment-method-id';
import { updateBookingCard } from './card-update';
import { CardUpdateError, type CardUpdateResult } from './card-update-errors';

// Server action de la página de actualización de tarjeta (spec 0029 §5.2). El acceso se valida con
// el token del enlace del email. No depende del flag: una reserva que ya está esperando un cobro
// tiene que poder recuperarse aunque el checkout diferido se haya apagado.

const TOKEN_MAX_LENGTH = 200;

const PayloadSchema = z.object({
  token: z.string().min(1).max(TOKEN_MAX_LENGTH),
  paymentMethodId: z.string().regex(PAYMENT_METHOD_ID_PATTERN),
  // El mandato de cargo sobre la tarjeta nueva se exige también del lado del servidor.
  mandateAccepted: z.literal(true),
});

export type CardUpdatePayload = z.infer<typeof PayloadSchema>;

export async function updateCardAction(payload: CardUpdatePayload): Promise<CardUpdateResult> {
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: CardUpdateError.Generic };

  const db = createSupabaseServiceClient();
  const bookingId = await validateBookingToken(db, parsed.data.token);
  if (!bookingId) return { ok: false, error: CardUpdateError.Unavailable };

  try {
    return await updateBookingCard(db, bookingId, parsed.data.paymentMethodId);
  } catch (err) {
    // PRIV-06 (spec 0023): solo el mensaje, nunca el objeto.
    console.error('[card-update]', err instanceof Error ? err.message : '');
    return { ok: false, error: CardUpdateError.Generic };
  }
}
