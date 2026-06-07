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
