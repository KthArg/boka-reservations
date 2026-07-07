/** Reportes exportables a CSV (spec 0012). */
export enum ReportKind {
  Revenue = 'revenue',
  Occupancy = 'occupancy',
  Refunds = 'refunds',
}

/** Errores de validación del rango de fechas de un reporte. */
export enum ReportRangeError {
  Missing = 'missing',
  Inverted = 'inverted',
  TooLong = 'too-long',
}

/** Código del 400 cuando el query param `report` no existe (spec 0028, B13). */
export const REPORT_UNKNOWN_ERROR = 'report_unknown';
