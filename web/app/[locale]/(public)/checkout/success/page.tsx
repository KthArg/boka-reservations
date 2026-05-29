import { getTranslations, getLocale } from 'next-intl/server';
import Link from 'next/link';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import styles from './success.module.css';

const BOOKING_SHORT_ID_LEN = 8;

type Props = { searchParams: Promise<{ booking?: string }> };

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const { booking: bookingId } = await searchParams;
  const [t, locale] = await Promise.all([getTranslations('checkout'), getLocale()]);

  let booking = null;
  let tourName: string | null = null;
  let dateLabel: string | null = null;

  if (bookingId) {
    const db = createSupabaseServiceClient();
    const { data } = await db
      .from('bookings')
      .select('id, customer_name, customer_email, tour_instance_id, status')
      .eq('id', bookingId)
      .single();

    if (data) {
      booking = data;
      const { data: instance } = await db
        .from('tour_instances')
        .select('starts_at, tour_id')
        .eq('id', data.tour_instance_id)
        .single();

      if (instance) {
        const { data: tour } = await db
          .from('tours')
          .select('name_es, name_en')
          .eq('id', instance.tour_id)
          .single();

        tourName = tour ? (locale === 'es' ? tour.name_es : tour.name_en) : null;
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

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('success-title')}</h1>
      {booking ? (
        <div className={styles.card}>
          <p>
            <strong>{t('success-booking')}</strong>
            {booking.id.slice(0, BOOKING_SHORT_ID_LEN).toUpperCase()}
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
          <p>
            <strong>{t('success-name')}</strong> {booking.customer_name}
          </p>
          <p>
            <strong>{t('success-email')}</strong> {booking.customer_email}
          </p>
        </div>
      ) : null}
      <Link href={`/${locale}/tours`} className={styles.link}>
        {t('success-back')}
      </Link>
    </div>
  );
}
