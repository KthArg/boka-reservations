/**
 * Identidad del operador (spec 0034): la razón social, la marca y los datos de contacto que los
 * términos, el aviso de privacidad, el pie del sitio, el pie de los correos y el resumen de compra
 * muestran. Vive en un solo lugar, `business_settings`, y se edita desde el panel.
 */
export type OperatorIdentity = {
  legalName: string;
  taxId: string;
  address: string;
  brand: string;
  contactEmail: string;
  privacyEmail: string;
  phone: string;
  hours: string;
  /** Número de la declaratoria turística del ICT. Vacío si el operador no la tiene. */
  ictDeclaration: string;
  hasLiabilityPolicy: boolean;
};

/** Los datos sin los cuales los textos no se pueden publicar ni se puede vender. */
export const REQUIRED_OPERATOR_FIELDS = [
  'legalName',
  'taxId',
  'address',
  'brand',
  'contactEmail',
  'privacyEmail',
  'phone',
  'hours',
] as const satisfies readonly (keyof OperatorIdentity)[];

export function isOperatorIdentityComplete(operator: OperatorIdentity): boolean {
  return REQUIRED_OPERATOR_FIELDS.every((field) => operator[field].trim().length > 0);
}
