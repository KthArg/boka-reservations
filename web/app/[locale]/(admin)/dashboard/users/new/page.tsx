import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/server';
import { UserRole } from '@shared/constants/enums';
import UserForm from '@/components/admin/UserForm';
import styles from './new.module.css';

type Props = { params: Promise<{ locale: string }> };

export default async function NewUserPage({ params }: Props) {
  const { locale } = await params;
  try {
    await requireRole(UserRole.Admin);
  } catch {
    redirect(`/${locale}/dashboard`);
  }
  const t = await getTranslations('users');
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('new-user')}</h1>
      <UserForm />
    </div>
  );
}
