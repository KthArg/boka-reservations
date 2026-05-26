import { getTranslations } from 'next-intl/server';
import TourForm from '@/components/tours/TourForm';
import styles from './new.module.css';

export default async function NewTourPage() {
  const t = await getTranslations('tours');
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('create-tour')}</h1>
      <TourForm />
    </div>
  );
}
