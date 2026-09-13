/**
 * Códigos de error de las actions de gestión de tours (spec 0028, B1/B12).
 * Reemplazan los mensajes en español hardcodeados: el server devuelve el código
 * y la UI lo traduce (claves `tours.errors.*` en locales es/en), mismo patrón
 * que UserManagementError.
 */
export enum TourActionError {
  Unauthorized = 'tour_unauthorized',
  SlugTaken = 'tour_slug_taken',
  CreateFailed = 'tour_create_failed',
  UpdateFailed = 'tour_update_failed',
  PricingWriteFailed = 'tour_pricing_write_failed',
  SchedulesWriteFailed = 'tour_schedules_write_failed',
  /** Dos temporadas activas solapadas para el mismo tipo (validación + constraint …041). */
  PricingOverlap = 'tour_pricing_overlap',
  /** Temporada con una sola fecha: el CHECK valid_season_range exige ambas o ninguna. */
  SeasonDatesIncomplete = 'tour_season_dates_incomplete',
  /** Temporada de un día o invertida: valid_season_range exige from < until estricto. */
  SeasonRangeInvalid = 'tour_season_range_invalid',
  /** Dos precios base activos para el mismo tipo. */
  BasePriceDuplicate = 'tour_base_price_duplicate',
  /** No se puede eliminar un horario con salidas ya generadas (FK); desactivarlo. */
  ScheduleInUse = 'tour_schedule_in_use',
  /** No se archiva un tour con reservas activas en salidas futuras (spec 0028, B12). */
  ArchiveHasBookings = 'tour_archive_has_bookings',
  ArchiveFailed = 'tour_archive_failed',
}

/** Códigos SQLSTATE que las actions mapean a errores de dominio. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_FK_VIOLATION = '23503';
