import { getTranslations, getLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { releaseHeldBooking } from '@/lib/booking/release-hold';
import { HOLD_SESSION_COOKIE } from '@shared/constants/bookings';
import styles from './cancel.module.css';

type Props = { searchParams: Promise<{ booking?: string }> };

export default async function CheckoutCancelPage({ searchParams }: Props) {
  const { booking: bookingId } = await searchParams;
  const [t, locale] = await Promise.all([getTranslations('checkout'), getLocale()]);

  let tourSlug: string | null = null;

  if (bookingId) {
    // La liberación vive en lib/ (spec 0028, B6): valida propiedad por cookie, chequea
    // errores y es idempotente. El GET con side-effect es el tradeoff documentado ahí.
    const cookieToken = (await cookies()).get(HOLD_SESSION_COOKIE)?.value;
    if (cookieToken) await releaseHeldBooking(bookingId, cookieToken);

    const db = createSupabaseServiceClient();
    const { data: booking } = await db
      .from('bookings')
      .select('tour_instance_id, tour_instances!inner(tours!inner(slug))')
      .eq('id', bookingId)
      .maybeSingle<{ tour_instances: { tours: { slug: string } } }>();
    tourSlug = booking?.tour_instances?.tours?.slug ?? null;
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
