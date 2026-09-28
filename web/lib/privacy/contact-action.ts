'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { writeAuditLog } from '@/lib/audit/log';
import { AuditAction, AuditActorType, AuditEntityType } from '@shared/constants/audit';
import { UserRole } from '@shared/constants/enums';
import { NotificationStatus } from '@shared/constants/notifications';

// Corrección de nombre y correo a pedido del turista (aviso de privacidad, P7; spec 0036).

export type ContactCorrectionResult =
  | { ok: true }
  | { ok: false; error: 'unauthorized' | 'invalid' | 'not-found' | 'error-generic' };

const NAME_MAX_LENGTH = 200;

const ContactSchema = z.object({
  bookingId: z.string().uuid(),
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  email: z.string().trim().toLowerCase().email(),
});

export async function correctBookingContact(
  _prev: ContactCorrectionResult | null,
  formData: FormData,
): Promise<ContactCorrectionResult> {
  const admin = await requireRole(UserRole.Admin).catch(() => null);
  if (!admin) return { ok: false, error: 'unauthorized' };

  const parsed = ContactSchema.safeParse({
    bookingId: formData.get('bookingId'),
    name: formData.get('name'),
    email: formData.get('email'),
  });
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { bookingId, name, email } = parsed.data;

  const db = createSupabaseServiceClient();
  const { data: before, error: readError } = await db
    .from('bookings')
    .select('customer_name, customer_email, anonymized_at')
    .eq('id', bookingId)
    .maybeSingle();
  if (readError) return { ok: false, error: 'error-generic' };
  // Una reserva anonimizada ya no tiene datos de nadie que corregir.
  if (!before || before.anonymized_at !== null) return { ok: false, error: 'not-found' };

  // Si la anonimización corrió entre la lectura y esta escritura, no se reescriben datos.
  const { data: updated, error } = await db
    .from('bookings')
    .update({ customer_name: name, customer_email: email })
    .eq('id', bookingId)
    .is('anonymized_at', null)
    .select('id');
  if (!error && updated.length === 0) return { ok: false, error: 'not-found' };
  if (error) {
    console.error('[privacy] correct contact:', error.message, bookingId);
    return { ok: false, error: 'error-generic' };
  }
  // Los avisos que todavía no salieron van al correo corregido.
  const { error: noticesError } = await db
    .from('notifications')
    .update({ recipient_email: email })
    .eq('booking_id', bookingId)
    .eq('status', NotificationStatus.Pending);
  if (noticesError) {
    console.error('[privacy] correct notices:', noticesError.message, bookingId);
    return { ok: false, error: 'error-generic' };
  }

  await writeAuditLog(db, {
    actorType: AuditActorType.Admin,
    actorId: admin.id,
    action: AuditAction.BookingContactCorrected,
    entityType: AuditEntityType.Booking,
    entityId: bookingId,
    // Solo qué cambió: audit_logs no se anonimiza ni se purga, y guardar el nombre o el correo
    // ahí los conservaría para siempre, contra lo que promete el aviso (P6).
    metadata: {
      fields: [
        ...(before.customer_name !== name ? ['name'] : []),
        ...(before.customer_email !== email ? ['email'] : []),
      ],
    },
  });

  revalidatePath(`/dashboard/bookings/${bookingId}`);
  return { ok: true };
}
