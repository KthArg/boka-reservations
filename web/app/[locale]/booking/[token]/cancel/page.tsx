import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { validateBookingToken } from '@/lib/booking/access-token';
import { getBookingView } from '@/lib/booking/cancel';
import { formatMoneyCents } from '@/lib/format/money';
import { BookingStatus } from '@shared/constants/enums';
import { CancelConfirm } from '../CancelConfirm';
import styles from '../booking.module.css';

type Props = { params: Promise<{ locale: string; token: string }> };

export default async function BookingCancelPage({ params }: Props) {
  const { locale, token } = await params;
  const t = await getTranslations('cancellation');

  const db = createSupabaseServiceClient();
  const bookingId = await validateBookingToken(db, token);
  const view = bookingId ? await getBookingView(db, bookingId) : null;

  if (!view) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t('cancel-title')}</h1>
          <p className={styles.muted}>{t('error-invalid')}</p>
        </div>
      </main>
    );
  }

  if (view.status !== BookingStatus.Confirmed) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t('cancel-title')}</h1>
          <p className={styles.muted}>{t('already')}</p>
          <Link href={`/booking/${token}`} className={styles.link}>
            {t('back')}
          </Link>
        </div>
      </main>
    );
  }

  const tourName = locale === 'es' ? view.tourNameEs : view.tourNameEn;
  const refundLabel = view.refund.eligible
    ? t('refund-yes', { amount: formatMoneyCents(view.refund.amountCents, view.currency, locale) })
    : t('refund-no');

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('cancel-title')}</h1>
        <p className={styles.tourLine}>{tourName}</p>
        <p className={view.refund.eligible ? styles.refundYes : styles.refundNo}>{refundLabel}</p>
        <CancelConfirm token={token} currency={view.currency} />
        <Link href={`/booking/${token}`} className={styles.link}>
          {t('back')}
        </Link>
      </div>
    </main>
  );
}
