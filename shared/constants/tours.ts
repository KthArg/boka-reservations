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
  /** Dos temporadas activas que comparten un día del año (validación + trigger de …052, spec 0040). */
  PricingOverlap = 'tour_pricing_overlap',
  /** Temporada con una sola punta: el CHECK tour_pricing_season_shape exige las dos o ninguna. */
  SeasonDatesIncomplete = 'tour_season_dates_incomplete',
  /** Temporada con un día que no existe (31 de abril): CHECK tour_pricing_season_days. */
  SeasonRangeInvalid = 'tour_season_range_invalid',
  /** Temporada sin nombre: el CHECK tour_pricing_season_shape lo exige (spec 0040). */
  SeasonLabelRequired = 'tour_season_label_required',
  /** Dos precios base activos para el mismo tipo. */
  BasePriceDuplicate = 'tour_base_price_duplicate',
  /** Horario con vigencia invertida: el generador no crearía salidas en silencio. */
  ScheduleRangeInvalid = 'tour_schedule_range_invalid',
  /** No se puede eliminar un horario con salidas ya generadas (FK); desactivarlo. */
  ScheduleInUse = 'tour_schedule_in_use',
  /** Los horarios se guardaron pero el retiro de salidas fuera de vigencia falló (spec 0044). */
  ScheduleWithdrawFailed = 'tour_schedule_withdraw_failed',
  /** No se archiva un tour con reservas activas en salidas futuras (spec 0028, B12). */
  ArchiveHasBookings = 'tour_archive_has_bookings',
  /** El tour vende tiquete de niño y no publica las edades (spec 0034, cláusula 3). */
  ChildAgesRequired = 'tour_child_ages_required',
  ChildAgesInvalid = 'tour_child_ages_invalid',
  /** Punto de encuentro con reservas confirmadas en salidas futuras (trigger de …049, spec 0035). */
  MeetingPointLocked = 'tour_meeting_point_locked',
  /** La foto no es un archivo del almacenamiento propio (spec 0036). */
  CoverImageInvalid = 'tour_cover_image_invalid',
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

/**
 * Rango de `tours.charge_lead_hours`. El piso es de 32 horas (el CHECK de DB admite desde 1): el
 * ciclo de cobro vence 30 horas antes de la salida, para que el staff decida con el aviso de 24
 * horas que prometen los términos todavía por delante, y con menos no habría ventana para cobrar.
 * Espeja el piso de departure_charge_due (…055).
 */
export const CHARGE_LEAD_HOURS_MIN = 32;
export const CHARGE_LEAD_HOURS_MAX = 720;

/**
 * Debajo de este plazo el formulario avisa: el ciclo vence 30 horas antes de la salida, así que
 * con menos de 38 horas el reintento de las 6 horas de una tarjeta rechazada ya no entra.
 */
export const CHARGE_LEAD_HOURS_WARN_BELOW = 38;

/** Edad máxima del tiquete de niño: 17 (espejo del CHECK `tours_child_ages_check`, spec 0034). */
export const CHILD_AGE_MAX = 17;

/** Mensaje con que el trigger tours_meeting_point_lock (…049) rechaza el cambio. */
export const MEETING_POINT_LOCKED = 'MEETING_POINT_LOCKED';
