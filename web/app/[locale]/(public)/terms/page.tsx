import { getTranslations } from 'next-intl/server';
import { LegalPage } from '@/components/public/LegalPage/LegalPage';

export default async function TermsPage() {
  const t = await getTranslations('legal');
  return <LegalPage title={t('terms-title')} body={t('terms-body')} backLabel={t('back')} />;
}
