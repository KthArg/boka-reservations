import { LegalTextPage } from '@/components/public/LegalPage/LegalTextPage';
import { LegalText } from '@/content/legal/registry';

type Props = { params: Promise<{ version: string }> };

/** Una versión publicada de los términos, tal como se aceptó (spec 0034). */
export default async function TermsVersionPage({ params }: Props) {
  const { version } = await params;
  return <LegalTextPage text={LegalText.Terms} version={version} />;
}
