import { getTranslations } from 'next-intl/server';
import TourForm from '@/components/tours/TourForm';
import { getBusinessSettings } from '@/lib/settings/repository';
import styles from './new.module.css';

export default async function NewTourPage() {
  const [t, settings] = await Promise.all([getTranslations('tours'), getBusinessSettings()]);
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('create-tour')}</h1>
      <TourForm defaultChargeLeadHours={settings.default_charge_lead_hours} />
    </div>
  );
}
