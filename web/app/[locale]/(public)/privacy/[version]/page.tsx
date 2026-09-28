import { LegalTextPage } from '@/components/public/LegalPage/LegalTextPage';
import { LegalText } from '@/content/legal/registry';

type Props = { params: Promise<{ version: string }> };

/** Una versión publicada del aviso de privacidad, tal como se aceptó (spec 0034). */
export default async function PrivacyVersionPage({ params }: Props) {
  const { version } = await params;
  return <LegalTextPage text={LegalText.Privacy} version={version} />;
}
