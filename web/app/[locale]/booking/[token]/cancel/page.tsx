import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { validateBookingToken } from '@/lib/booking/access-token';
import { getBookingView, type BookingView } from '@/lib/booking/cancel';
import { formatMoneyCents } from '@/lib/format/money';
import { BookingStatus } from '@shared/constants/enums';
import { BookingNotice } from '../BookingNotice';
import { CancelConfirm } from '../CancelConfirm';
import styles from '../booking.module.css';

type Props = { params: Promise<{ locale: string; token: string }> };
type Translate = Awaited<ReturnType<typeof getTranslations<'cancellation'>>>;

function refundLabel(view: BookingView, unpaid: boolean, t: Translate, locale: string): string {
  if (unpaid) return t('no-charge-yet');
  if (!view.refund.eligible) return t('refund-no');
  return t('refund-yes', {
    amount: formatMoneyCents(view.refund.amountCents, view.currency, locale),
  });
}

export default async function BookingCancelPage({ params }: Props) {
  const { locale, token } = await params;
  const t = await getTranslations('cancellation');

  const db = createSupabaseServiceClient();
  const bookingId = await validateBookingToken(db, token);
  const view = bookingId ? await getBookingView(db, bookingId) : null;
  const backHref = `/booking/${token}`;

  if (!view) return <BookingNotice title={t('cancel-title')} message={t('error-invalid')} />;

  // Cobro diferido en curso (spec 0029 §5.8): la reserva sigue activa, pero hay que esperar.
  // Cancelables: confirmadas (con la política de reembolso) y reservas sin cobrar del flujo
  // diferido (spec 0029), que se cancelan sin costo.
  const unpaid = view.status === BookingStatus.PendingMinimum;
  const notice = view.chargeInFlight
    ? t('error-charge-in-flight')
    : view.status !== BookingStatus.Confirmed && !unpaid
      ? t('already')
      : null;
  if (notice) {
    return (
      <BookingNotice
        title={t('cancel-title')}
        message={notice}
        backHref={backHref}
        backLabel={t('back')}
      />
    );
  }

  const tourName = locale === 'es' ? view.tourNameEs : view.tourNameEn;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('cancel-title')}</h1>
        <p className={styles.tourLine}>{tourName}</p>
        <p className={unpaid || view.refund.eligible ? styles.refundYes : styles.refundNo}>
          {refundLabel(view, unpaid, t, locale)}
        </p>
        <CancelConfirm token={token} currency={view.currency} unpaid={unpaid} />
        <Link href={backHref} className={styles.link}>
          {t('back')}
        </Link>
      </div>
    </main>
  );
}
