import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireAnyRole } from '@/lib/auth/server';
import { ADMIN_PANEL_ROLES } from '@shared/constants/bookings';
import { ReportKind } from '@shared/constants/reports';
import { defaultReportRange, validateReportRange, type ReportRange } from '@/lib/reports/range';
import { getRevenueReport, getOccupancyReport, getRefundsSummary } from '@/lib/reports/queries';
import { ReportsFilters } from './ReportsFilters';
import { RevenueSection } from './RevenueSection';
import { OccupancySection } from './OccupancySection';
import { RefundsSection } from './RefundsSection';
import { TopToursSection } from './TopToursSection';
import styles from './reports.module.css';

type SearchParams = { from?: string; to?: string };
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> };

function exportHref(locale: string, kind: ReportKind, range: ReportRange): string {
  const sp = new URLSearchParams({ report: kind, from: range.from, to: range.to });
  // Ruta absoluta con locale: un href relativo se resolvería contra
  // /{locale}/dashboard/ (la página no lleva barra final) → 404.
  return `/${locale}/dashboard/reports/export?${sp.toString()}`;
}

export default async function ReportsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  try {
    await requireAnyRole(ADMIN_PANEL_ROLES);
  } catch {
    redirect(`/${locale}/dashboard`);
  }

  const t = await getTranslations('reports');
  const sp = await searchParams;
  const range: ReportRange = sp.from && sp.to ? { from: sp.from, to: sp.to } : defaultReportRange();
  const rangeError = validateReportRange(range.from, range.to);

  let body: React.ReactNode;
  if (rangeError) {
    body = <p className={styles.error}>{t(`range-error-${rangeError}`)}</p>;
  } else {
    const [revenue, occupancy, refunds] = await Promise.all([
      getRevenueReport(range),
      getOccupancyReport(range),
      getRefundsSummary(range),
    ]);
    body = (
      <>
        <RevenueSection
          rows={revenue}
          locale={locale}
          exportHref={exportHref(locale, ReportKind.Revenue, range)}
        />
        <OccupancySection
          rows={occupancy}
          locale={locale}
          exportHref={exportHref(locale, ReportKind.Occupancy, range)}
        />
        <RefundsSection
          summary={refunds}
          locale={locale}
          exportHref={exportHref(locale, ReportKind.Refunds, range)}
        />
        <TopToursSection revenue={revenue} occupancy={occupancy} locale={locale} />
      </>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('page-title')}</h1>
      <ReportsFilters range={range} />
      {body}
    </div>
  );
}
