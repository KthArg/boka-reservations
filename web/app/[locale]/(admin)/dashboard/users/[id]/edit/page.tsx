import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/server';
import { getUserById } from '@/lib/users/repository';
import { UserRole } from '@shared/constants/enums';
import UserForm from '@/components/admin/UserForm';
import styles from './edit.module.css';

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function EditUserPage({ params }: Props) {
  const { locale, id } = await params;
  try {
    await requireRole(UserRole.Admin);
  } catch {
    redirect(`/${locale}/dashboard`);
  }
  const [t, user] = await Promise.all([getTranslations('users'), getUserById(id)]);
  if (!user) notFound();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('edit-user')}</h1>
      <UserForm user={user} />
    </div>
  );
}
