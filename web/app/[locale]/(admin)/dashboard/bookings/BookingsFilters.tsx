import { getTranslations, getLocale } from 'next-intl/server';
import { BookingStatus } from '@shared/constants/enums';
import type { BookingFilters } from '@/lib/booking/admin-types';
import type { TourListItem } from '@/lib/tours/types';
import styles from './bookings.module.css';

type Props = {
  filters: BookingFilters;
  tours: TourListItem[];
  exportQuery: string;
};

const STATUS_OPTIONS = Object.values(BookingStatus);

export async function BookingsFilters({ filters, tours, exportQuery }: Props) {
  const t = await getTranslations('bookings');
  const locale = await getLocale();
  const canExport = Boolean(filters.dateFrom && filters.dateTo);

  return (
    <form className={styles.filters} method="get" action="">
      <div className={styles.field}>
        <label className={styles.label} htmlFor="dateFrom">
          {t('filter-from')}
        </label>
        <input
          className={styles.input}
          type="date"
          id="dateFrom"
          name="dateFrom"
          defaultValue={filters.dateFrom ?? ''}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="dateTo">
          {t('filter-to')}
        </label>
        <input
          className={styles.input}
          type="date"
          id="dateTo"
          name="dateTo"
          defaultValue={filters.dateTo ?? ''}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="tourId">
          {t('filter-tour')}
        </label>
        <select
          className={styles.select}
          id="tourId"
          name="tourId"
          defaultValue={filters.tourId ?? ''}
        >
          <option value="">{t('filter-all-tours')}</option>
          {tours.map((tour) => (
            <option key={tour.id} value={tour.id}>
              {tour.name_es}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="status">
          {t('filter-status')}
        </label>
        <select
          className={styles.select}
          id="status"
          name="status"
          defaultValue={filters.status ?? ''}
        >
          <option value="">{t('filter-all-status')}</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {t(`status-${status}`)}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="search">
          {t('filter-search')}
        </label>
        <input
          className={styles.input}
          type="search"
          id="search"
          name="search"
          defaultValue={filters.search ?? ''}
        />
      </div>

      <div className={styles.filterButtons}>
        <button type="submit" className={styles.primaryBtn}>
          {t('filter-apply')}
        </button>
        {canExport ? (
          <a
            className={styles.secondaryBtn}
            href={`/${locale}/dashboard/bookings/export${exportQuery}`}
          >
            {t('export-csv')}
          </a>
        ) : (
          <span className={styles.exportDisabled} title={t('export-hint')}>
            {t('export-csv')}
          </span>
        )}
      </div>
    </form>
  );
}
