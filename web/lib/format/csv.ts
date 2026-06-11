// Helper genérico de CSV (spec 0012). UTF-8 con BOM para que Excel respete las
// tildes; entrecomilla los campos con coma, comilla o salto de línea.
const BOM = '﻿';

// Defensa contra CSV/formula injection (spec 0016, M-4): Excel/Sheets ejecutan como
// FÓRMULA cualquier campo que empiece con uno de estos caracteres. Datos del cliente
// (customer_name/email) llegan al CSV de reservas; un `=HYPERLINK(...)` exfiltraría
// datos al abrirlo. NO eliminar este prefijo aunque parezca inocuo.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Escapa un campo CSV: neutraliza fórmulas (prefijo `'` si arranca con `= + - @` tab/CR)
 * y entrecomilla si tiene coma, comilla o salto de línea.
 */
export function escapeCsvField(value: string): string {
  const safe = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/** Serializa una tabla (header + filas) a CSV con BOM UTF-8. */
export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((cells) => cells.map(escapeCsvField).join(','));
  return BOM + lines.join('\r\n');
}
