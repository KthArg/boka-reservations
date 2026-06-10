import { z } from 'zod';

// Tope de tickets por reserva, validado server-side (spec 0015). El `max` del input HTML
// es solo UX; esta es la autoridad. Vive en web/lib (no en @shared): el worker no
// participa del checkout.
export const MAX_TICKETS_PER_BOOKING = 10;

// Cada cantidad: entero ≥ 0 y ≤ tope. `z.coerce.number` rechaza valores no numéricos
// (NaN → falla `.int()`) y decimales; un campo ausente/empty coerciona a 0.
const QuantitySchema = z.coerce.number().int().min(0).max(MAX_TICKETS_PER_BOOKING);

const TicketQuantitiesSchema = z
  .object({
    adult: QuantitySchema,
    child: QuantitySchema,
    student: QuantitySchema,
  })
  .refine((q) => {
    const total = q.adult + q.child + q.student;
    return total > 0 && total <= MAX_TICKETS_PER_BOOKING;
  });

export type TicketQuantities = z.infer<typeof TicketQuantitiesSchema>;

type RawQuantities = {
  adult: FormDataEntryValue | null;
  child: FormDataEntryValue | null;
  student: FormDataEntryValue | null;
};

/** Valida las cantidades crudas del formulario. Devuelve null si son inválidas. */
export function parseTicketQuantities(raw: RawQuantities): TicketQuantities | null {
  const parsed = TicketQuantitiesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
