import { getTranslations, getLocale } from 'next-intl/server';
import Link from 'next/link';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import styles from './cancel.module.css';

type Props = { searchParams: Promise<{ booking?: string }> };

export default async function CheckoutCancelPage({ searchParams }: Props) {
  const { booking: bookingId } = await searchParams;
  const [t, locale] = await Promise.all([getTranslations('checkout'), getLocale()]);

  let tourSlug: string | null = null;

  if (bookingId) {
    const db = createSupabaseServiceClient();
    const { data: booking } = await db
      .from('bookings')
      .select('id, hold_id, tour_instance_id, status')
      .eq('id', bookingId)
      .single();

    if (booking) {
      if (booking.hold_id && booking.status === 'pending_payment') {
        await db
          .from('tour_holds')
          .update({ status: 'released' })
          .eq('id', booking.hold_id)
          .eq('status', 'active');
      }

      const { data: instance } = await db
        .from('tour_instances')
        .select('tour_id')
        .eq('id', booking.tour_instance_id)
        .single();

      if (instance) {
        const { data: tour } = await db
          .from('tours')
          .select('slug')
          .eq('id', instance.tour_id)
          .single();

        tourSlug = tour?.slug ?? null;
      }
    }
  }

  const retryHref = tourSlug ? `/${locale}/tours/${tourSlug}` : `/${locale}/tours`;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('cancel-title')}</h1>
      <p className={styles.body}>{t('cancel-body')}</p>
      <div className={styles.actions}>
        <Link href={retryHref} className={styles.primaryLink}>
          {t('cancel-retry')}
        </Link>
        <Link href={`/${locale}/tours`} className={styles.secondaryLink}>
          {t('cancel-back')}
        </Link>
      </div>
    </div>
  );
}
