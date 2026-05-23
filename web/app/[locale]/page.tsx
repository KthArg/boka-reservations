import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations('common');
  return (
    <main>
      <h1>Boka Trails</h1>
      <p>{t('under-construction')}</p>
    </main>
  );
}
