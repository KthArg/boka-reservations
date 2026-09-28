import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getOperatorIdentity } from '@/lib/operator/repository';
import { isOperatorIdentityComplete } from '@/lib/operator/types';
import { legalDocumentFor, latestVersion, type LegalTextValue } from '@/content/legal/registry';
import { LegalPage, LegalPageUnavailable } from './LegalPage';

type Props = {
  text: LegalTextValue;
  /** Sin versión: la vigente. Con versión inexistente: 404. */
  version?: string;
};

/**
 * Página de términos o de aviso de privacidad (spec 0034), para la ruta vigente y para las rutas
 * versionadas que enlaza el correo de confirmación. Mientras falten los datos del operador no
 * muestra el texto: la venta está cerrada por la misma razón.
 */
export async function LegalTextPage({ text, version }: Props) {
  const [locale, t, operator] = await Promise.all([
    getLocale(),
    getTranslations('legal'),
    getOperatorIdentity(),
  ]);
  const resolvedVersion = version ?? latestVersion(text);
  const factory = legalDocumentFor(text, resolvedVersion, locale);
  if (!factory) notFound();

  if (!isOperatorIdentityComplete(operator)) {
    return <LegalPageUnavailable title={t(`${text}-title`)} message={t('not-published')} />;
  }

  return (
    <LegalPage
      document={factory(operator)}
      labels={{
        back: t('back'),
        print: t('print'),
        version: t('version-label', { version: resolvedVersion }),
      }}
    />
  );
}
