import { describe, it, expect } from 'vitest';
import { BookingStatus } from '@shared/constants/enums';
import { ExportRangeError } from '@shared/constants/bookings';
import { parseBookingFilters, validateExportRange, filtersToSearchParams } from './admin-filters';

describe('parseBookingFilters', () => {
  it('usa página 1 por defecto cuando no viene page', () => {
    expect(parseBookingFilters({}).page).toBe(1);
  });

  it('parsea page numérico y descarta valores inválidos', () => {
    expect(parseBookingFilters({ page: '3' }).page).toBe(3);
    expect(parseBookingFilters({ page: '0' }).page).toBe(1);
    expect(parseBookingFilters({ page: 'abc' }).page).toBe(1);
    expect(parseBookingFilters({ page: '-2' }).page).toBe(1);
  });

  it('conserva filtros válidos y recorta el search', () => {
    const f = parseBookingFilters({
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      tourId: 'tour-1',
      search: '  ana  ',
    });
    expect(f.dateFrom).toBe('2026-01-01');
    expect(f.dateTo).toBe('2026-02-01');
    expect(f.tourId).toBe('tour-1');
    expect(f.search).toBe('ana');
  });

  it('ignora un status desconocido y acepta uno válido', () => {
    expect(parseBookingFilters({ status: 'inventado' }).status).toBeUndefined();
    expect(parseBookingFilters({ status: 'confirmed' }).status).toBe(BookingStatus.Confirmed);
  });

  it('omite search vacío tras recortar', () => {
    expect(parseBookingFilters({ search: '   ' }).search).toBeUndefined();
  });
});

describe('validateExportRange', () => {
  it('rechaza cuando falta dateFrom o dateTo', () => {
    expect(validateExportRange({ page: 1 })).toBe(ExportRangeError.Missing);
    expect(validateExportRange({ page: 1, dateFrom: '2026-01-01' })).toBe(ExportRangeError.Missing);
  });

  it('rechaza fechas no parseables', () => {
    expect(validateExportRange({ page: 1, dateFrom: 'x', dateTo: 'y' })).toBe(
      ExportRangeError.Missing,
    );
  });

  it('rechaza formato no estricto que Date.parse aceptaría (APPSEC-01)', () => {
    // `Date.parse('2026-01-01"')` es válido y rompería el header Content-Disposition del export.
    expect(validateExportRange({ page: 1, dateFrom: '2026-01-01"', dateTo: '2026-02-01' })).toBe(
      ExportRangeError.Missing,
    );
    expect(validateExportRange({ page: 1, dateFrom: '2026-1-1', dateTo: '2026-02-01' })).toBe(
      ExportRangeError.Missing,
    );
  });

  it('rechaza un rango mayor a un año', () => {
    expect(validateExportRange({ page: 1, dateFrom: '2025-01-01', dateTo: '2026-06-01' })).toBe(
      ExportRangeError.TooLong,
    );
  });

  it('acepta un rango válido dentro del año', () => {
    expect(
      validateExportRange({ page: 1, dateFrom: '2026-01-01', dateTo: '2026-12-01' }),
    ).toBeNull();
  });

  it('acepta el mismo día como rango', () => {
    expect(
      validateExportRange({ page: 1, dateFrom: '2026-03-10', dateTo: '2026-03-10' }),
    ).toBeNull();
  });
});

describe('filtersToSearchParams', () => {
  it('devuelve cadena vacía sin filtros ni page', () => {
    expect(filtersToSearchParams({ page: 1 })).toBe('');
  });

  it('omite la página 1 e incluye páginas mayores', () => {
    expect(filtersToSearchParams({ page: 1 }, 1)).toBe('');
    expect(filtersToSearchParams({ page: 1 }, 3)).toBe('?page=3');
  });

  it('serializa los filtros presentes', () => {
    const qs = filtersToSearchParams({
      page: 1,
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      tourId: 't1',
      search: 'ana',
    });
    expect(qs).toContain('dateFrom=2026-01-01');
    expect(qs).toContain('dateTo=2026-02-01');
    expect(qs).toContain('tourId=t1');
    expect(qs).toContain('search=ana');
  });
});
