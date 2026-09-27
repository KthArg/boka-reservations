import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/server';
import { getBusinessSettings } from '@/lib/settings/repository';
import { UserRole } from '@shared/constants/enums';
import { SettingsForm } from './SettingsForm';
import styles from './settings.module.css';

type Props = { params: Promise<{ locale: string }> };

export default async function SettingsPage({ params }: Props) {
  const { locale } = await params;
  try {
    await requireRole(UserRole.Admin);
  } catch {
    redirect(`/${locale}/dashboard`);
  }

  const [t, settings] = await Promise.all([getTranslations('settings'), getBusinessSettings()]);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('page-title')}</h1>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('section-minimum')}</h2>
        <SettingsForm
          decisionWindowHours={settings.minimum_decision_window_hours}
          chargeLeadHours={settings.default_charge_lead_hours}
        />
      </section>
    </div>
  );
}
