// Datos de tarjeta del formulario propio (spec 0029 §5.2). Validación de forma en el navegador,
// solo para dar feedback antes de tokenizar: la autoridad es OnvoPay (tokeniza y verifica) y el
// servidor (lee la tarjeta por GET y valida el vencimiento contra la salida). Estos datos NUNCA
// se envían a nuestro backend.

export type CardFormValues = {
  number: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  holderName: string;
};

export type CardInput = {
  number: string;
  expMonth: number;
  expYear: number;
  cvv: string;
  holderName: string;
};

export const EMPTY_CARD: CardFormValues = {
  number: '',
  expMonth: '',
  expYear: '',
  cvv: '',
  holderName: '',
};

/** Largo máximo de cada campo del formulario (el número admite espacios o guiones). */
export const CARD_FIELD_MAX_LENGTH: Record<keyof CardFormValues, number> = {
  holderName: 120,
  number: 23,
  expMonth: 2,
  expYear: 4,
  cvv: 4,
};

const CARD_NUMBER = /^\d{12,19}$/;
const CVV = /^\d{3,4}$/;
const MONTH = /^\d{1,2}$/;
// Año de 2 o 4 dígitos: "203" no es un año válido ni se completa a nada.
const YEAR = /^(\d{2}|\d{4})$/;
const MIN_MONTH = 1;
const MAX_MONTH = 12;
const TWO_DIGIT_YEAR_LENGTH = 2;
const CENTURY = 2000;

function onlyDigits(value: string): string {
  return value.replace(/[\s-]/g, '');
}

/** Normaliza y valida la forma; null si algún campo es inválido. */
export function toCardInput(values: CardFormValues): CardInput | null {
  const number = onlyDigits(values.number);
  const cvv = values.cvv.trim();
  const holderName = values.holderName.trim();
  const monthText = values.expMonth.trim();
  const yearText = values.expYear.trim();

  if (!CARD_NUMBER.test(number) || !CVV.test(cvv)) return null;
  if (!MONTH.test(monthText) || !YEAR.test(yearText)) return null;
  if (holderName.length === 0 || holderName.length > CARD_FIELD_MAX_LENGTH.holderName) return null;

  const expMonth = Number(monthText);
  if (expMonth < MIN_MONTH || expMonth > MAX_MONTH) return null;
  const rawYear = Number(yearText);
  const expYear = yearText.length === TWO_DIGIT_YEAR_LENGTH ? CENTURY + rawYear : rawYear;

  return { number, expMonth, expYear, cvv, holderName };
}
