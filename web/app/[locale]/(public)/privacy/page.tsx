import { getTranslations } from 'next-intl/server';
import { LegalPage } from '@/components/public/LegalPage/LegalPage';

export default async function PrivacyPage() {
  const t = await getTranslations('legal');
  return <LegalPage title={t('privacy-title')} body={t('privacy-body')} backLabel={t('back')} />;
}
