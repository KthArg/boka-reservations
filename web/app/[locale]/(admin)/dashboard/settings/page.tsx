import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/server';
import { getBusinessSettings } from '@/lib/settings/repository';
import { UserRole } from '@shared/constants/enums';
import type { BelowMinimumPolicy } from '@shared/constants/settings';
import { SettingsForm } from './SettingsForm';
import { OperatorSettingsForm } from './OperatorSettingsForm';
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
        <h2 className={styles.sectionTitle}>{t('section-operator')}</h2>
        <OperatorSettingsForm
          initial={{
            operator_legal_name: settings.operator_legal_name,
            operator_tax_id: settings.operator_tax_id,
            operator_address: settings.operator_address,
            operator_brand: settings.operator_brand,
            operator_contact_email: settings.operator_contact_email,
            operator_privacy_email: settings.operator_privacy_email,
            operator_phone: settings.operator_phone,
            operator_hours: settings.operator_hours,
            operator_ict_declaration: settings.operator_ict_declaration,
            operator_has_liability_policy: settings.operator_has_liability_policy,
            no_show_tolerance_minutes: settings.no_show_tolerance_minutes,
          }}
        />
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('section-minimum')}</h2>
        <SettingsForm
          decisionWindowHours={settings.minimum_decision_window_hours}
          chargeLeadHours={settings.default_charge_lead_hours}
          bookingCutoffHours={settings.booking_cutoff_hours}
          belowMinimumPolicy={settings.below_minimum_policy as BelowMinimumPolicy}
        />
      </section>
    </div>
  );
}
