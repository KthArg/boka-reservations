import { getTranslations } from 'next-intl/server';
import styles from './page.module.css';

export default async function DashboardPage() {
  const t = await getTranslations('auth');
  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>{t('admin-panel-title')}</h1>
      <p className={styles.subtitle}>{t('panel-under-construction')}</p>
    </div>
  );
}
