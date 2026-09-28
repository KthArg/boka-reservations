import { LegalTextPage } from '@/components/public/LegalPage/LegalTextPage';
import { LegalText } from '@/content/legal/registry';

export default function TermsPage() {
  return <LegalTextPage text={LegalText.Terms} />;
}
