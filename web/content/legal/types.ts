import type { OperatorIdentity } from '@/lib/operator/types';

// Forma de un documento legal como datos (spec 0034). Los textos son contenido, no código: se
// escriben acá como secciones de párrafos y listas y los muestra un único componente. Cada
// versión publicada es inmutable; un cambio de texto es una versión nueva.

export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: readonly string[] }
  | { kind: 'table'; head: readonly string[]; rows: readonly (readonly string[])[] };

export type LegalSection = {
  /** Ancla estable de la sección: el pie del sitio enlaza `#quejas`. */
  id: string;
  title: string;
  blocks: readonly LegalBlock[];
};

export type LegalDocument = {
  title: string;
  intro: readonly LegalBlock[];
  sections: readonly LegalSection[];
};

/** Un documento se arma con los datos del operador, que viven en el panel. */
export type LegalDocumentFactory = (operator: OperatorIdentity) => LegalDocument;

export const p = (text: string): LegalBlock => ({ kind: 'p', text });
export const ul = (...items: string[]): LegalBlock => ({ kind: 'ul', items });
