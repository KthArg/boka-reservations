import { NextResponse } from 'next/server';
import { requireAnyRole } from '@/lib/auth/server';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import { ReportKind } from '@shared/constants/reports';
import { validateReportRange, type ReportRange } from '@/lib/reports/range';
import { getRevenueReport, getOccupancyReport, getRefundsSummary } from '@/lib/reports/queries';
import { revenueToCsv, occupancyToCsv, refundsSummaryToCsv } from '@/lib/reports/csv';

type RouteContext = { params: Promise<{ locale: string }> };

async function buildCsv(
  report: string,
  range: ReportRange,
  locale: string,
): Promise<[string, string] | null> {
  if (report === ReportKind.Revenue) {
    return [revenueToCsv(await getRevenueReport(range), locale), 'ingresos'];
  }
  if (report === ReportKind.Occupancy) {
    return [occupancyToCsv(await getOccupancyReport(range), locale), 'ocupacion'];
  }
  if (report === ReportKind.Refunds) {
    return [refundsSummaryToCsv(await getRefundsSummary(range)), 'reembolsos'];
  }
  return null;
}

export async function GET(request: Request, { params }: RouteContext): Promise<NextResponse> {
  const user = await requireAnyRole(ADMIN_PANEL_ROLES).catch(() => null);
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const { locale } = await params;
  const sp = new URL(request.url).searchParams;
  const from = sp.get('from') ?? undefined;
  const to = sp.get('to') ?? undefined;

  if (validateReportRange(from, to)) {
    return new NextResponse('Rango de fechas inválido.', { status: 400 });
  }
  const range: ReportRange = { from: from as string, to: to as string };

  const result = await buildCsv(sp.get('report') ?? '', range, locale);
  if (!result) return new NextResponse('Reporte desconocido.', { status: 400 });

  const [csv, name] = result;
  const filename = `${name}-${range.from}_${range.to}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
