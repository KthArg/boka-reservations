import type { SupabaseClient } from '@supabase/supabase-js';

// Helper de teardown para tests de integración (spec 0026, ítem 3). Las suites comparten una
// única DB local; cada una debe borrar lo que creó. Este helper borra tours de prueba y TODA su
// descendencia en orden de FK, operando sobre los ids EXPLÍCITOS que la suite creó (no por prefijo
// de slug, que es frágil e incompleto). Idempotente: con ids inexistentes no hace nada.
//
// No es un archivo de test (no matchea `*.test.ts`), así que vitest no lo colecta.
export async function deleteToursDeep(admin: SupabaseClient, tourIds: string[]): Promise<void> {
  if (tourIds.length === 0) return;

  const { data: instances } = await admin
    .from('tour_instances')
    .select('id')
    .in('tour_id', tourIds);
  const instanceIds = (instances ?? []).map((r) => r.id);

  if (instanceIds.length > 0) {
    const { data: bookings } = await admin
      .from('bookings')
      .select('id')
      .in('tour_instance_id', instanceIds);
    const bookingIds = (bookings ?? []).map((r) => r.id);

    if (bookingIds.length > 0) {
      // Hijos de bookings (FK → bookings). audit_logs es append-only (trigger): no se borra.
      await admin.from('notifications').delete().in('booking_id', bookingIds);
      await admin.from('refunds').delete().in('booking_id', bookingIds);
      await admin.from('payments').delete().in('booking_id', bookingIds);
      await admin.from('booking_access_tokens').delete().in('booking_id', bookingIds);
    }

    await admin.from('bookings').delete().in('tour_instance_id', instanceIds);
    await admin.from('tour_instance_guides').delete().in('tour_instance_id', instanceIds);
  }

  // Hijos directos de tours + el tour.
  await admin.from('tour_instances').delete().in('tour_id', tourIds);
  await admin.from('tour_pricing').delete().in('tour_id', tourIds);
  await admin.from('tour_schedules').delete().in('tour_id', tourIds);
  await admin.from('tours').delete().in('id', tourIds);
}
