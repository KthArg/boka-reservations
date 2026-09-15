import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { validateBookingToken } from '@/lib/booking/access-token';
import {
  AccessDeniedReason,
  loadAuthenticationTarget,
} from '@/lib/booking/deferred-booking-access';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import { formatMoneyCents } from '@/lib/format/money';
import { getPaymentProvider } from '@/lib/payments';
import { PaymentIntentStatus } from '@/lib/payments/types';
import { BookingNotice } from '../BookingNotice';
import { AuthenticateCharge } from './AuthenticateCharge';
import styles from '../booking.module.css';

type Props = { params: Promise<{ locale: string; token: string }> };

/**
 * Lee el intent antes de ofrecer el desafío: tras un 3DS rechazado vuelve a requires_payment_method
 * y el watchdog recién lo registra más tarde. Si OnvoPay no responde, se ofrece igual.
 */
async function stillRequiresAction(intentId: string): Promise<boolean> {
  const snapshot = await getPaymentProvider()
    .getPaymentIntent(intentId)
    .catch(() => null);
  return snapshot === null || snapshot.status === PaymentIntentStatus.RequiresAction;
}

/**
 * Autenticación 3DS del cobro de una reserva (spec 0029 §5.7). Llega por el enlace del aviso. Solo
 * con el cobro en vuelo esperando autenticación; en cualquier otro estado no entrega el intent.
 */
export default async function AuthenticateChargePage({ params }: Props) {
  const { locale, token } = await params;
  const t = await getTranslations('cancellation');

  const db = createSupabaseServiceClient();
  const bookingId = await validateBookingToken(db, token);
  if (!bookingId) {
    return <BookingNotice title={t('authenticate-title')} message={t('error-invalid')} />;
  }

  const access = await loadAuthenticationTarget(db, bookingId);
  const available = access.ok && (await stillRequiresAction(access.target.paymentIntentId));
  if (!access.ok || !available) {
    const cancelled = !access.ok && access.reason === AccessDeniedReason.Cancelled;
    return (
      <BookingNotice
        title={t('authenticate-title')}
        message={cancelled ? t('booking-cancelled') : t('authenticate-unavailable')}
        backHref={`/booking/${token}`}
        backLabel={t('back')}
      />
    );
  }

  const { target } = access;
  const deadline = formatOperatorDateTime(target.awaitingActionUntil);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('authenticate-title')}</h1>
        <p className={styles.tourLine}>{locale === 'es' ? target.tourNameEs : target.tourNameEn}</p>
        <p>
          {t('authenticate-intro', {
            amount: formatMoneyCents(target.totalAmountCents, target.currency, locale),
            date: `${deadline.date} ${deadline.time}`,
          })}
        </p>
        <AuthenticateCharge paymentIntentId={target.paymentIntentId} />
        <Link href={`/booking/${token}`} className={styles.link}>
          {t('back')}
        </Link>
      </div>
    </main>
  );
}
