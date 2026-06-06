// Helper genérico de CSV (spec 0012). UTF-8 con BOM para que Excel respete las
// tildes; entrecomilla los campos con coma, comilla o salto de línea.
const BOM = '﻿';

/** Escapa un campo CSV: entrecomilla si tiene coma, comilla o salto de línea. */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Serializa una tabla (header + filas) a CSV con BOM UTF-8. */
export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((cells) => cells.map(escapeCsvField).join(','));
  return BOM + lines.join('\r\n');
}
