/** Reportes exportables a CSV (spec 0012). */
export enum ReportKind {
  Revenue = 'revenue',
  Occupancy = 'occupancy',
  Refunds = 'refunds',
}

/**
 * A qué fecha se aplica el rango del reporte de ingresos (spec 0046). Espejo de `p_basis` de
 * `report_revenue`: la fecha del pago (criterio de caja, el de siempre) o la de la salida.
 */
export enum RevenueBasis {
  Payment = 'payment',
  Departure = 'departure',
}

/** El criterio pedido en la URL; cualquier valor desconocido es la fecha de pago. */
export function parseRevenueBasis(raw: string | null | undefined): RevenueBasis {
  return raw === RevenueBasis.Departure ? RevenueBasis.Departure : RevenueBasis.Payment;
}

/** Errores de validación del rango de fechas de un reporte. */
export enum ReportRangeError {
  Missing = 'missing',
  Inverted = 'inverted',
  TooLong = 'too-long',
}

/** Código del 400 cuando el query param `report` no existe (spec 0028, B13). */
export const REPORT_UNKNOWN_ERROR = 'report_unknown';
