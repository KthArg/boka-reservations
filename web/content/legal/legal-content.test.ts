// Textos legales publicados (spec 0034): cada versión existe en los dos idiomas, la vigente es la
// que estampan las reservas, y ningún texto sale con marcadores de relleno.
import { describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '@shared/constants/legal';
import type { OperatorIdentity } from '@/lib/operator/types';
import {
  LegalText,
  latestVersion,
  legalDocumentFor,
  publishedVersions,
  type LegalTextValue,
} from './registry';
import type { LegalDocument } from './types';

const OPERATOR: OperatorIdentity = {
  legalName: 'Boka Verde Tours S.A.',
  taxId: '3-101-123456',
  address: 'San José, Escazú',
  brand: 'Boka Verde',
  contactEmail: 'hola@bokaverde.cr',
  privacyEmail: 'privacidad@bokaverde.cr',
  phone: '+506 2222-2222',
  hours: 'de lunes a viernes, de 8:00 a. m. a 5:00 p. m.',
  ictDeclaration: '',
  hasLiabilityPolicy: false,
};

const TEXTS: LegalTextValue[] = [LegalText.Terms, LegalText.Privacy];
const LOCALES = ['es', 'en'] as const;

function allText(document: LegalDocument): string {
  const blocks = [...document.intro, ...document.sections.flatMap((s) => s.blocks)];
  const parts = blocks.flatMap((block) => {
    if (block.kind === 'p') return [block.text];
    if (block.kind === 'ul') return [...block.items];
    return [...block.head, ...block.rows.flat()];
  });
  return [document.title, ...document.sections.map((s) => s.title), ...parts].join('\n');
}

describe('registro de versiones', () => {
  it('la versión vigente de los términos es la que estampan las reservas', () => {
    expect(latestVersion(LegalText.Terms)).toBe(TERMS_VERSION);
  });

  it('la versión vigente del aviso es la que estampan las reservas', () => {
    expect(latestVersion(LegalText.Privacy)).toBe(PRIVACY_NOTICE_VERSION);
  });

  it('una versión que no existe no tiene documento', () => {
    expect(legalDocumentFor(LegalText.Terms, '2020-01-01', 'es')).toBeNull();
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'la versión %s, que llega de la URL, no tiene documento',
    (version) => {
      expect(legalDocumentFor(LegalText.Terms, version, 'es')).toBeNull();
    },
  );

  it('un idioma desconocido cae en la versión en español, que es la que prevalece', () => {
    const factory = legalDocumentFor(LegalText.Terms, TERMS_VERSION, 'fr');
    expect(factory?.(OPERATOR).title).toBe('Términos y condiciones de reserva');
  });
});

describe.each(TEXTS)('contenido de %s', (text) => {
  it.each(publishedVersions(text).flatMap((v) => LOCALES.map((l) => [v, l] as const)))(
    'la versión %s en %s no tiene marcadores de relleno',
    (version, locale) => {
      // Arrange
      const factory = legalDocumentFor(text, version, locale);

      // Act
      const content = allText(factory!(OPERATOR));

      // Assert
      expect(content).not.toMatch(/[[\]{}]/);
      expect(content).not.toMatch(/PENDIENTE|PENDING|undefined|null/);
    },
  );

  it('las anclas de sección son únicas', () => {
    const document = legalDocumentFor(text, latestVersion(text), 'es')!(OPERATOR);
    const ids = document.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('frases que dependen del operador', () => {
  const terms = (operator: OperatorIdentity) =>
    allText(legalDocumentFor(LegalText.Terms, TERMS_VERSION, 'es')!(operator));

  it('nombra la declaratoria del ICT solo si el operador la tiene', () => {
    expect(terms(OPERATOR)).not.toContain('Declaratoria');
    expect(terms({ ...OPERATOR, ictDeclaration: 'D-123' })).toContain(
      'Declaratoria turística del ICT número D-123',
    );
  });

  it('nombra la póliza solo si el operador la tiene', () => {
    expect(terms(OPERATOR)).not.toContain('póliza');
    expect(terms({ ...OPERATOR, hasLiabilityPolicy: true })).toContain(
      'póliza de responsabilidad civil',
    );
  });

  it('el pie enlaza la sección de quejas con un ancla que existe', () => {
    const document = legalDocumentFor(LegalText.Terms, TERMS_VERSION, 'es')!(OPERATOR);
    expect(document.sections.map((s) => s.id)).toContain('quejas');
  });
});
