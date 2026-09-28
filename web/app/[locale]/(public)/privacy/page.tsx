import { LegalTextPage } from '@/components/public/LegalPage/LegalTextPage';
import { LegalText } from '@/content/legal/registry';

export default function PrivacyPage() {
  return <LegalTextPage text={LegalText.Privacy} />;
}
