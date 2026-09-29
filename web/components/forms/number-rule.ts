/** Qué número acepta un campo: mínimo, máximo opcional y si tiene que ser entero. */
export type NumberRule = { min: number; max?: number; integer?: boolean };

/** Un valor que el campo no pudo leer (vacío o texto) llega como NaN y nunca es válido. */
export function isValidNumber(value: number, rule: NumberRule): boolean {
  return (
    Number.isFinite(value) &&
    value >= rule.min &&
    (rule.max === undefined || value <= rule.max) &&
    (!rule.integer || Number.isInteger(value))
  );
}

/** Lo escrito como número; vacío o ilegible da NaN (no 0: un campo vacío no es un cero). */
export function parseDraft(draft: string): number {
  const trimmed = draft.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

/** Lleva un valor al rango de la regla; vacío o ilegible vuelve al mínimo. */
export function clampToRule(value: number, rule: NumberRule): number {
  if (!Number.isFinite(value)) return rule.min;
  const rounded = rule.integer ? Math.round(value) : value;
  const floor = Math.max(rule.min, rounded);
  return rule.max === undefined ? floor : Math.min(rule.max, floor);
}
