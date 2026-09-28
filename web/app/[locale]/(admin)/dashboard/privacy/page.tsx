import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/server';
import { UserRole } from '@shared/constants/enums';
import { PrivacyErasure } from './PrivacyErasure';
import styles from './privacy.module.css';

type Props = { params: Promise<{ locale: string }> };

/**
 * Pedidos de datos personales (aviso de privacidad, P7; spec 0036). Solo admin: borrar los datos
 * de una persona es irreversible. Corregir un nombre o un correo se hace desde el detalle de la
 * reserva.
 */
export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  try {
    await requireRole(UserRole.Admin);
  } catch {
    redirect(`/${locale}/dashboard`);
  }

  const t = await getTranslations('privacy');
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('page-title')}</h1>
      <p className={styles.intro}>{t('page-intro')}</p>
      <PrivacyErasure />
    </div>
  );
}
