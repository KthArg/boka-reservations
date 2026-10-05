import { routing } from '@/i18n/routing';
import type { LegalDocumentFactory } from './types';
import { termsEs } from './terms/2026-09-27.es';
import { termsEn } from './terms/2026-09-27.en';
import { termsEs as termsEs20261005 } from './terms/2026-10-05.es';
import { termsEn as termsEn20261005 } from './terms/2026-10-05.en';
import { privacyEs } from './privacy/2026-09-27.es';
import { privacyEn } from './privacy/2026-09-27.en';

// Versiones publicadas de los textos legales (spec 0034). Una versión, una vez publicada, no se
// edita: cada reserva guarda la versión que aceptó y el correo de confirmación la enlaza. Para
// publicar una versión nueva se agrega una entrada acá y se sube `TERMS_VERSION` o
// `PRIVACY_NOTICE_VERSION` en `shared/constants/legal.ts` a esa misma fecha.

export const LegalText = {
  Terms: 'terms',
  Privacy: 'privacy',
} as const;

export type LegalTextValue = (typeof LegalText)[keyof typeof LegalText];

type LegalLocale = (typeof routing.locales)[number];

type Versions = Readonly<Record<string, Readonly<Record<LegalLocale, LegalDocumentFactory>>>>;

const REGISTRY: Readonly<Record<LegalTextValue, Versions>> = {
  [LegalText.Terms]: {
    '2026-09-27': { es: termsEs, en: termsEn },
    '2026-10-05': { es: termsEs20261005, en: termsEn20261005 },
  },
  [LegalText.Privacy]: {
    '2026-09-27': { es: privacyEs, en: privacyEn },
  },
};

/** Versiones publicadas de un texto, de la más vieja a la vigente (formato `YYYY-MM-DD`). */
export function publishedVersions(text: LegalTextValue): string[] {
  return Object.keys(REGISTRY[text]).sort();
}

export function latestVersion(text: LegalTextValue): string {
  const versions = publishedVersions(text);
  const latest = versions[versions.length - 1];
  if (!latest) throw new Error(`Sin versiones publicadas de ${text}`);
  return latest;
}

/** El documento de una versión en un idioma, o `null` si esa versión no existe. */
export function legalDocumentFor(
  text: LegalTextValue,
  version: string,
  locale: string,
): LegalDocumentFactory | null {
  // La versión llega de la URL: solo claves propias del registro, nunca las heredadas del objeto.
  if (!Object.hasOwn(REGISTRY[text], version)) return null;
  const byLocale = REGISTRY[text][version]!;
  const known = routing.locales.find((l) => l === locale);
  return byLocale[known ?? routing.defaultLocale];
}
