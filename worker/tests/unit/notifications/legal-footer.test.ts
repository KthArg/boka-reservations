// Pie legal de los correos (spec 0034; textos aprobados §3.5) y el IVA espejado del worker.
import { describe, expect, it } from 'vitest';
import {
  FooterAudience,
  withLegalFooter,
} from '../../../src/notifications/templates/legal-footer.js';
import {
  BRAND_TEXT_HEADER,
  LEGAL_FOOTER_MARKER,
  wrapHtml,
} from '../../../src/notifications/templates/layout.js';
import { renderBookingLegal } from '../../../src/notifications/templates/booking-legal.js';
import { vatIncludedCents } from '../../../src/notifications/templates/format.js';
import { vatIncludedCents as sharedVatIncludedCents } from '../../../../shared/constants/policies.js';
import type { OperatorIdentity } from '../../../src/notifications/operator.js';

const OPERATOR: OperatorIdentity = {
  legalName: 'Boka Verde Tours S.A.',
  taxId: '3-101-123456',
  address: 'San José, Escazú',
  brand: 'Boka Verde',
  contactEmail: 'hola@bokaverde.cr',
  phone: '+506 2222-2222',
};

const EMAIL = { subject: 'Asunto', html: wrapHtml('<p>Cuerpo</p>'), text: 'Cuerpo' };

function footer(overrides: Partial<Parameters<typeof withLegalFooter>[1]> = {}) {
  return withLegalFooter(EMAIL, {
    operator: OPERATOR,
    locale: 'es',
    audience: FooterAudience.Customer,
    appUrl: 'https://example.com',
    ...overrides,
  });
}

describe('withLegalFooter', () => {
  it('reemplaza el marcador con la identidad del operador y los enlaces legales', () => {
    // Act
    const out = footer();

    // Assert
    expect(out.html).not.toContain(LEGAL_FOOTER_MARKER);
    expect(out.html).toContain('Boka Verde Tours S.A., cédula jurídica 3-101-123456');
    expect(out.html).toContain('https://example.com/es/terms');
    expect(out.html).toContain('https://example.com/es/privacy');
    expect(out.text).toContain('Consultas y reclamos: hola@bokaverde.cr');
  });

  it('le recuerda al turista por qué recibe el correo', () => {
    expect(footer().text).toContain(
      'Recibiste este correo porque hiciste una reserva con Boka Verde',
    );
  });

  it('no le dice a un guía que hizo una reserva', () => {
    const out = footer({ audience: FooterAudience.Guide });
    expect(out.text).not.toContain('hiciste una reserva');
    expect(out.text).toContain('cédula jurídica 3-101-123456');
  });

  it('cambia el nombre en texto del encabezado por el logo servido por la app (spec 0042)', () => {
    const out = footer();
    expect(out.html).not.toContain(BRAND_TEXT_HEADER);
    expect(out.html).toContain('src="https://example.com/brand/logo-hueso.png"');
    expect(out.html).toContain('alt="Boka Verde"');
  });

  it('sin el paso de envío, el encabezado queda con el nombre en texto', () => {
    expect(EMAIL.html).toContain(BRAND_TEXT_HEADER);
  });

  it('en inglés usa el texto traducido', () => {
    const out = footer({ locale: 'en' });
    expect(out.text).toContain('legal ID 3-101-123456');
    expect(out.html).toContain('https://example.com/en/terms');
  });

  it('con la identidad incompleta deja solo los enlaces, sin huecos', () => {
    const out = footer({ operator: { ...OPERATOR, taxId: '' } });
    expect(out.text).not.toContain('cédula jurídica');
    expect(out.text).toContain('https://example.com/es/terms');
  });
});

describe('vatIncludedCents del worker', () => {
  it.each([0, 1, 6000, 9000, 15_000, 123_457])(
    'coincide con el cálculo de shared para %i centavos',
    (cents) => {
      expect(vatIncludedCents(cents)).toBe(sharedVatIncludedCents(cents));
    },
  );
});

describe('renderBookingLegal — versiones aceptadas', () => {
  const input = {
    appUrl: 'https://example.com',
    termsVersion: '2026-09-27',
    privacyVersion: '2026-09-27',
    toleranceMinutes: 15,
  };

  it('enlaza las versiones publicadas', () => {
    const { text } = renderBookingLegal(input, 'es');
    expect(text.join('\n')).toContain('https://example.com/es/terms/2026-09-27');
  });

  it('no enlaza una versión que no tiene página publicada', () => {
    const { html, text } = renderBookingLegal({ ...input, termsVersion: '2026-09-23' }, 'es');
    expect(html).not.toContain('/terms/');
    expect(text.join('\n')).not.toContain('Aceptaste');
  });
});
