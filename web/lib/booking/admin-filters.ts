import { BookingStatus } from '@shared/constants/enums';
import { EXPORT_MAX_RANGE_DAYS, ExportRangeError } from '@shared/constants/bookings';
import type { BookingFilters } from './admin-types';

const MS_PER_DAY = 86_400_000;
const FIRST_PAGE = 1;
// APPSEC-01 (spec 0023): formato estricto YYYY-MM-DD. `Date.parse` es laxo y acepta basura
// como `2026-01-01"` (válido), que llegaría al header Content-Disposition del export.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const BOOKING_STATUSES = new Set<string>(Object.values(BookingStatus));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < FIRST_PAGE) return FIRST_PAGE;
  return Math.floor(n);
}

function parseStatus(raw: string | undefined): BookingStatus | undefined {
  if (raw && BOOKING_STATUSES.has(raw)) return raw as BookingStatus;
  return undefined;
}

/**
 * Mapea query params crudos a filtros tipados. Ignora valores inválidos — también en
 * formato (spec 0028, B8): antes `?dateFrom=basura` o `?tourId=no-uuid` llegaban crudos
 * al query builder y PostgREST lanzaba (error page del panel).
 */
// Formato ISO Y fecha calendario real (review pre-PR): '2026-13-45' pasa el regex pero
// revienta crDayStartIso con RangeError → 500 del listado. El round-trip cubre además el
// rollover del parser de V8 ('2026-02-30' → 2 de marzo).
const isRealDate = (v: string): boolean => {
  if (!ISO_DATE.test(v)) return false;
  const t = Date.parse(v);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};

export function parseBookingFilters(params: Record<string, string | undefined>): BookingFilters {
  const filters: BookingFilters = { page: parsePage(params.page) };
  if (params.dateFrom && isRealDate(params.dateFrom)) filters.dateFrom = params.dateFrom;
  if (params.dateTo && isRealDate(params.dateTo)) filters.dateTo = params.dateTo;
  if (params.tourId && UUID_RE.test(params.tourId)) filters.tourId = params.tourId;
  const search = params.search?.trim();
  if (search) filters.search = search;
  const status = parseStatus(params.status);
  if (status) filters.status = status;
  return filters;
}

/**
 * Serializa filtros a query string (con `?` inicial), opcionalmente con page.
 * Omite valores vacíos y la página 1. Cadena vacía si no hay nada que serializar.
 */
export function filtersToSearchParams(filters: BookingFilters, page?: number): string {
  const sp = new URLSearchParams();
  if (filters.dateFrom) sp.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) sp.set('dateTo', filters.dateTo);
  if (filters.tourId) sp.set('tourId', filters.tourId);
  if (filters.status) sp.set('status', filters.status);
  if (filters.search) sp.set('search', filters.search);
  if (page && page > FIRST_PAGE) sp.set('page', String(page));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * Valida que el export tenga un rango de fechas presente y dentro del máximo.
 * Devuelve el motivo de rechazo, o null si es válido.
 */
export function validateExportRange(filters: BookingFilters): ExportRangeError | null {
  if (!filters.dateFrom || !filters.dateTo) return ExportRangeError.Missing;
  if (!ISO_DATE.test(filters.dateFrom) || !ISO_DATE.test(filters.dateTo)) {
    return ExportRangeError.Missing;
  }
  const from = Date.parse(filters.dateFrom);
  const to = Date.parse(filters.dateTo);
  if (Number.isNaN(from) || Number.isNaN(to)) return ExportRangeError.Missing;
  // Rango invertido (spec 0028, B8): antes `from > to` pasaba y el export salía vacío.
  if (to < from) return ExportRangeError.Inverted;
  if ((to - from) / MS_PER_DAY > EXPORT_MAX_RANGE_DAYS) return ExportRangeError.TooLong;
  return null;
}
