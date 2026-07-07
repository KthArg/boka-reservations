import { getTranslations, getLocale } from 'next-intl/server';
import Link from 'next/link';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { maskEmail } from '@/lib/format/mask-email';
import { BookingStatus } from '@shared/constants/enums';
import styles from './success.module.css';

type Props = { searchParams: Promise<{ booking?: string }> };

type SuccessBooking = {
  id: string;
  customer_email: string;
  tour_instance_id: string;
  status: string;
};

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const { booking: bookingId } = await searchParams;
  const [t, locale] = await Promise.all([getTranslations('checkout'), getLocale()]);

  let booking: SuccessBooking | null = null;
  let tourName: string | null = null;
  let dateLabel: string | null = null;

  if (bookingId) {
    const db = createSupabaseServiceClient();
    // PII (spec 0021, P1-1): NO se selecciona `customer_name` ni se renderiza el email completo.
    // `customer_email` se lee solo para enmascararlo server-side; el valor crudo no llega al HTML.
    const { data } = await db
      .from('bookings')
      .select('id, customer_email, tour_instance_id, status')
      .eq('id', bookingId)
      .maybeSingle();

    if (data) {
      booking = data;
      const { data: instance } = await db
        .from('tour_instances')
        .select('starts_at, tour_id, tours!inner(name_es, name_en)')
        .eq('id', data.tour_instance_id)
        .maybeSingle<{ starts_at: string; tours: { name_es: string; name_en: string } }>();

      if (instance) {
        tourName = locale === 'es' ? instance.tours.name_es : instance.tours.name_en;
        dateLabel = new Date(instance.starts_at).toLocaleString(
          locale === 'es' ? 'es-CR' : 'en-US',
          {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Costa_Rica',
          },
        );
      }
    }
  }

  // Honestidad del estado (spec 0028, B5): "¡Reserva confirmada!" SOLO con status
  // confirmed. Un pago aún en proceso (el webhook puede demorar) muestra "procesando";
  // cualquier otro estado (cancelada, mismatch, URL vieja del historial) un mensaje
  // neutro — antes cualquier UUID renderizaba la confirmación.
  const isConfirmed = booking?.status === BookingStatus.Confirmed;
  const isProcessing = booking?.status === BookingStatus.PendingPayment;
  const title = isConfirmed
    ? t('success-title')
    : isProcessing
      ? t('success-processing-title')
      : t('success-neutral-title');

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      {isProcessing && <p className={styles.body}>{t('success-processing-body')}</p>}
      {!isConfirmed && !isProcessing && <p className={styles.body}>{t('success-neutral-body')}</p>}
      {booking && isConfirmed ? (
        <div className={styles.card}>
          <p>
            <strong>{t('success-booking')}</strong>
            {booking.id.slice(0, 8).toUpperCase()}
          </p>
          {tourName && (
            <p>
              <strong>{t('success-tour')}</strong> {tourName}
            </p>
          )}
          {dateLabel && (
            <p>
              <strong>{t('success-date')}</strong> {dateLabel}
            </p>
          )}
          {maskEmail(booking.customer_email) && (
            <p>
              <strong>{t('success-email')}</strong> {maskEmail(booking.customer_email)}
            </p>
          )}
        </div>
      ) : null}
      <Link href={`/${locale}/tours`} className={styles.link}>
        {t('success-back')}
      </Link>
    </div>
  );
}
