import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { ADMIN_PANEL_ROLES, ExportRangeError } from '@shared/constants/bookings';
import { actorTypeForRole } from '@shared/constants/audit';
import { parseBookingFilters, validateExportRange } from '@/lib/booking/admin-filters';
import { listBookingsForExport } from '@/lib/booking/export-repository';
import { bookingsToCsv } from '@/lib/booking/csv';

const RANGE_ERROR_MESSAGE: Record<ExportRangeError, string> = {
  [ExportRangeError.Missing]: 'Definí un rango de fechas (desde y hasta) para exportar.',
  [ExportRangeError.TooLong]: 'El rango de exportación no puede superar un año.',
};

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user?.userRole) return new NextResponse('Unauthorized', { status: 401 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = parseBookingFilters(params);

  const rangeError = validateExportRange(filters);
  if (rangeError) return new NextResponse(RANGE_ERROR_MESSAGE[rangeError], { status: 400 });

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
