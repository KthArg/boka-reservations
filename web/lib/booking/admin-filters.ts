import { BookingStatus } from '@shared/constants/enums';
import { EXPORT_MAX_RANGE_DAYS, ExportRangeError } from '@shared/constants/bookings';
import type { BookingFilters } from './admin-types';

const MS_PER_DAY = 86_400_000;
const FIRST_PAGE = 1;

const BOOKING_STATUSES = new Set<string>(Object.values(BookingStatus));

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < FIRST_PAGE) return FIRST_PAGE;
  return Math.floor(n);
}

function parseStatus(raw: string | undefined): BookingStatus | undefined {
  if (raw && BOOKING_STATUSES.has(raw)) return raw as BookingStatus;
  return undefined;
}

/** Mapea query params crudos a filtros tipados. Ignora valores inválidos. */
export function parseBookingFilters(params: Record<string, string | undefined>): BookingFilters {
  const filters: BookingFilters = { page: parsePage(params.page) };
  if (params.dateFrom) filters.dateFrom = params.dateFrom;
  if (params.dateTo) filters.dateTo = params.dateTo;
  if (params.tourId) filters.tourId = params.tourId;
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
  const from = Date.parse(filters.dateFrom);
  const to = Date.parse(filters.dateTo);
  if (Number.isNaN(from) || Number.isNaN(to)) return ExportRangeError.Missing;
  if ((to - from) / MS_PER_DAY > EXPORT_MAX_RANGE_DAYS) return ExportRangeError.TooLong;
  return null;
}
