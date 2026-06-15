import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { listTours } from '@/lib/tours/repository';
import { listBookingsForAdmin } from '@/lib/booking/repository';
import { parseBookingFilters, filtersToSearchParams } from '@/lib/booking/admin-filters';
import { ADMIN_BOOKINGS_PAGE_SIZE } from '@shared/constants/bookings';
import { BookingsFilters } from './BookingsFilters';
import { BookingsTable } from './BookingsTable';
import { RefreshButton } from './RefreshButton';
import styles from './bookings.module.css';

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<SearchParams> };

const BASE = '/dashboard/bookings';

function normalize(params: SearchParams): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

export default async function BookingsPage({ searchParams }: Props) {
  const t = await getTranslations('bookings');
  const filters = parseBookingFilters(normalize(await searchParams));

  const [{ rows, total }, tours] = await Promise.all([listBookingsForAdmin(filters), listTours()]);

  const totalPages = Math.max(1, Math.ceil(total / ADMIN_BOOKINGS_PAGE_SIZE));
  const prevHref =
    filters.page > 1 ? `${BASE}${filtersToSearchParams(filters, filters.page - 1)}` : null;
  const nextHref =
    filters.page < totalPages ? `${BASE}${filtersToSearchParams(filters, filters.page + 1)}` : null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('page-title')}</h1>
        <div className={styles.headerActions}>
          <RefreshButton />
          <Link href="/dashboard/bookings/hoy" className={styles.secondaryBtn}>
            {t('today-link')}
          </Link>
        </div>
      </div>

      <BookingsFilters
        filters={filters}
        tours={tours}
        exportQuery={filtersToSearchParams(filters)}
      />

      {rows.length === 0 ? (
        <p className={styles.empty}>{t('empty')}</p>
      ) : (
        <>
          <BookingsTable rows={rows} />
          <div className={styles.pagination}>
            {prevHref ? (
              <Link href={prevHref} className={styles.secondaryBtn}>
                {t('pagination-prev')}
              </Link>
            ) : null}
            <span className={styles.pageInfo}>
              {t('pagination-page', { page: filters.page, total: totalPages })}
            </span>
            {nextHref ? (
              <Link href={nextHref} className={styles.secondaryBtn}>
                {t('pagination-next')}
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
