import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { validateBookingToken } from '@/lib/booking/access-token';
import { AccessDeniedReason, loadCardUpdateTarget } from '@/lib/booking/deferred-booking-access';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import { formatMoneyCents } from '@/lib/format/money';
import { BookingNotice } from '../BookingNotice';
import { CardUpdateForm } from './CardUpdateForm';
import styles from '../booking.module.css';

type Props = { params: Promise<{ locale: string; token: string }> };

/**
 * Actualización de la tarjeta de una reserva sin cobrar (spec 0029 §5.2, §5.7). Llega por el enlace
 * del aviso de tarjeta rechazada. Solo se muestra en `pending_minimum` con el plazo vigente.
 */
export default async function CardUpdatePage({ params }: Props) {
  const { locale, token } = await params;
  const t = await getTranslations('cancellation');

  const db = createSupabaseServiceClient();
  const bookingId = await validateBookingToken(db, token);
  if (!bookingId) return <BookingNotice title={t('card-title')} message={t('error-invalid')} />;

  const backHref = `/booking/${token}`;
  const access = await loadCardUpdateTarget(db, bookingId);
  if (!access.ok) {
    const cancelled = access.reason === AccessDeniedReason.Cancelled;
    return (
      <BookingNotice
        title={t('card-title')}
        message={cancelled ? t('booking-cancelled') : t('card-unavailable')}
        backHref={backHref}
        backLabel={t('back')}
      />
    );
  }

  const { target } = access;
  const amount = formatMoneyCents(target.totalAmountCents, target.currency, locale);
  const deadline = target.recoveryDeadline ? formatOperatorDateTime(target.recoveryDeadline) : null;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('card-title')}</h1>
        <p className={styles.tourLine}>{locale === 'es' ? target.tourNameEs : target.tourNameEn}</p>
        <p>{t('card-intro', { amount, last4: target.cardLast4 ?? '—' })}</p>
        {deadline ? (
          <p className={styles.muted}>
            {t('card-deadline', { date: `${deadline.date} ${deadline.time}` })}
          </p>
        ) : null}
        <CardUpdateForm token={token} customerId={target.customerId} amount={amount} />
        <Link href={backHref} className={styles.link}>
          {t('back')}
        </Link>
      </div>
    </main>
  );
}
