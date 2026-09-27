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
  /** Horario con vigencia invertida: el generador no crearía salidas en silencio. */
  ScheduleRangeInvalid = 'tour_schedule_range_invalid',
  /** No se puede eliminar un horario con salidas ya generadas (FK); desactivarlo. */
  ScheduleInUse = 'tour_schedule_in_use',
  /** No se archiva un tour con reservas activas en salidas futuras (spec 0028, B12). */
  ArchiveHasBookings = 'tour_archive_has_bookings',
  /**
   * No se archiva un tour con una salida en pleno ciclo de cobro (spec 0033): archivar cancela
   * la salida, y el motor no toca salidas canceladas, así que el ciclo quedaría abierto para
   * siempre, con retenciones vivas que nadie suelta.
   */
  ArchiveChargeInProgress = 'tour_archive_charge_in_progress',
  ArchiveFailed = 'tour_archive_failed',
}

/** Códigos SQLSTATE que las actions mapean a errores de dominio. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_FK_VIOLATION = '23503';

/**
 * Momento en que se cobra una salida del tour (spec 0033 §5.1). Espejo del CHECK de
 * `tours.charge_timing`; el worker mantiene su propia copia (no importa `@shared` en runtime).
 */
export const ChargeTiming = {
  /** Apenas los cupos vendidos llegan al mínimo del tour. */
  OnMinimum: 'on_minimum',
  /** A `charge_lead_hours` de la salida, o al valor global si el tour no fija uno. */
  BeforeDeparture: 'before_departure',
} as const;

export type ChargeTiming = (typeof ChargeTiming)[keyof typeof ChargeTiming];

/** Rango de `tours.charge_lead_hours`: espejo del CHECK de DB (1 hora a 30 días). */
export const CHARGE_LEAD_HOURS_MIN = 1;
export const CHARGE_LEAD_HOURS_MAX = 720;

/**
 * Debajo de este plazo el formulario avisa: `charge_attempt_failed` exige 2 horas de margen
 * para agendar un reintento, así que un rechazo se queda sin segundo intento (spec 0033 §5.1).
 */
export const CHARGE_LEAD_HOURS_WARN_BELOW = 6;
