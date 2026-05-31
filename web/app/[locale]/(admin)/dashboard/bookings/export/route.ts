import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/lib/auth/server';
import { ADMIN_PANEL_ROLES, ExportRangeError } from '@shared/constants/bookings';
import { parseBookingFilters, validateExportRange } from '@/lib/booking/admin-filters';
import { listBookingsForExport } from '@/lib/booking/export-repository';
import { bookingsToCsv } from '@/lib/booking/csv';

const RANGE_ERROR_MESSAGE: Record<ExportRangeError, string> = {
  [ExportRangeError.Missing]: 'Definí un rango de fechas (desde y hasta) para exportar.',
  [ExportRangeError.TooLong]: 'El rango de exportación no puede superar un año.',
};

export async function GET(request: Request): Promise<NextResponse> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = parseBookingFilters(params);

  const rangeError = validateExportRange(filters);
  if (rangeError) return new NextResponse(RANGE_ERROR_MESSAGE[rangeError], { status: 400 });

  const rows = await listBookingsForExport(filters);
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
