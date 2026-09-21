import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import { actorTypeForRole } from '@shared/constants/audit';
import { parseBookingFilters, validateExportRange } from '@/lib/booking/admin-filters';
import { listBookingsForExport } from '@/lib/booking/export-repository';
import { bookingsToCsv } from '@/lib/booking/csv';

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user?.userRole) return new NextResponse('Unauthorized', { status: 401 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = parseBookingFilters(params);

  // El 400 devuelve el CÓDIGO estable, no un mensaje en español (spec 0028, B13):
  // la UI que dispara el export ya valida y traduce; el body es para debugging.
  const rangeError = validateExportRange(filters);
  if (rangeError) return new NextResponse(rangeError, { status: 400 });

  const rows = await listBookingsForExport(filters);

  // PRIV-05 (spec 0023): el export descarga PII masiva (nombre + email de todas las reservas
  // del rango). Dejar traza en audit_logs (actor, rango, conteo) — sin PII. Best-effort: si
  // falla el registro, igual se sirve el CSV (no bloquear al operador), pero se loguea.
  const audit = createSupabaseServiceClient();
  const { error: auditError } = await audit.from('audit_logs').insert({
    actor_type: actorTypeForRole(user.userRole),
    actor_id: user.id,
    action: 'booking.export',
    entity_type: 'export',
    entity_id: crypto.randomUUID(),
    metadata: { from: filters.dateFrom, to: filters.dateTo, count: rows.length },
  });
  if (auditError) console.error('[bookings/export] audit falló (no bloquea):', auditError.message);

  const csv = bookingsToCsv(rows);
  const filename = `reservas-${filters.dateFrom}_${filters.dateTo}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
