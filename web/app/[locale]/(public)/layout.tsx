import { SiteFooter } from '@/components/public/SiteFooter/SiteFooter';
import { SiteHeader } from '@/components/public/SiteHeader/SiteHeader';
import styles from './layout.module.css';

type Props = { children: React.ReactNode };

export default function PublicLayout({ children }: Props) {
  return (
    <div className={styles.wrapper}>
      <SiteHeader />
      <main className={styles.main}>{children}</main>
      <SiteFooter />
    </div>
  );
}
