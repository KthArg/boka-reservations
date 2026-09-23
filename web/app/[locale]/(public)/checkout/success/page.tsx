import { getTranslations, getLocale } from 'next-intl/server';
import Link from 'next/link';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { maskEmail } from '@/lib/format/mask-email';
import { isWithinSuccessWindow } from '@/lib/booking/success-window';
import { BookingStatus } from '@shared/constants/enums';
import styles from './success.module.css';

type Props = { searchParams: Promise<{ booking?: string }> };

// Título y cuerpo por estado de la reserva; cualquier otro estado ve el mensaje neutro.
const SUCCESS_COPY = {
  [BookingStatus.Confirmed]: { title: 'success-title', body: null },
  [BookingStatus.PendingMinimum]: {
    title: 'success-reserved-title',
    body: 'success-reserved-body',
  },
  [BookingStatus.PendingPayment]: {
    title: 'success-processing-title',
    body: 'success-processing-body',
  },
} as const;

const NEUTRAL_COPY = { title: 'success-neutral-title', body: 'success-neutral-body' } as const;

function successCopy(status: string | undefined) {
  return SUCCESS_COPY[status as keyof typeof SUCCESS_COPY] ?? NEUTRAL_COPY;
}

type SuccessBooking = {
  id: string;
  customer_email: string;
  tour_instance_id: string;
  status: string;
  created_at: string;
  charge_started_at: string | null;
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
      .select('id, customer_email, tour_instance_id, status, created_at, charge_started_at')
      .eq('id', bookingId)
      .maybeSingle();

    // Spec 0031 §5.3: fuera de la ventana, la página se comporta como si la reserva no existiera
    // (la dirección queda en el historial del navegador y en los logs de la plataforma).
    const visible =
      data !== null &&
      isWithinSuccessWindow({
        createdAt: data.created_at,
        chargeStartedAt: data.charge_started_at,
        now: new Date(),
      });

    if (data && visible) {
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
  // Cobro diferido (spec 0029): la reserva queda registrada con la tarjeta guardada y sin cobro.
  const isReserved = booking?.status === BookingStatus.PendingMinimum;
  const copy = successCopy(booking?.status);
  const title = t(copy.title);
  const body = copy.body ? t(copy.body) : null;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      {body && <p className={styles.body}>{body}</p>}
      {booking && (isConfirmed || isReserved) ? (
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
