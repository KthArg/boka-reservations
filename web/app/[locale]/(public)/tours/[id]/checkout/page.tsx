import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getTranslations, getLocale } from 'next-intl/server';
import {
  getTourBySlug,
  getTourPricingForDay,
  getUpcomingInstances,
  isClosedForOnlineBooking,
} from '@/lib/public/tours';
import { Link } from '@/i18n/navigation';
import { crClockTime, crDate } from '@/lib/dates/cr-date';
import { isTourBookable } from '@/lib/public/tour-bookable';
import { isDeferredChargeEnabled } from '@/lib/booking/deferred-flag';
import {
  getBookingCutoffHours,
  getNoShowToleranceMinutes,
  getOperatorIdentity,
} from '@/lib/operator/repository';
import { isOperatorIdentityComplete } from '@/lib/operator/types';
import { CheckoutForm } from '@/components/public/CheckoutForm/CheckoutForm';
import { DeferredCheckoutForm } from '@/components/public/CheckoutForm/DeferredCheckoutForm';
import type { PurchaseSummaryInfo } from '@/components/public/CheckoutForm/PurchaseSummary';
import { ShiftBadge } from '@/components/public/ShiftBadge/ShiftBadge';
import { shiftOfTime } from '@/lib/public/shift';
import styles from './checkout.module.css';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ instance?: string }> };

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { id: slug } = await params;
  const { instance: instanceId } = await searchParams;

  if (!instanceId || !z.string().uuid().safeParse(instanceId).success) notFound();

  const [t, locale, tour, operator, toleranceMinutes, cutoffHours] = await Promise.all([
    getTranslations('checkout'),
    getLocale(),
    getTourBySlug(slug),
    getOperatorIdentity(),
    getNoShowToleranceMinutes(),
    getBookingCutoffHours(),
  ]);

  if (!tour) notFound();

  const instances = await getUpcomingInstances(tour.id, cutoffHours);
  const instance = instances.find((i) => i.id === instanceId);
  if (!instance) {
    // Spec 0041: una salida disponible pero dentro de la anticipación mínima muestra el aviso;
    // una cancelada, ya pasada o inexistente sigue siendo 404.
    if (!(await isClosedForOnlineBooking(tour.id, instanceId, cutoffHours))) notFound();
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{locale === 'es' ? tour.name_es : tour.name_en}</h1>
        <p>{t('booking-closed')}</p>
        <p>
          <Link href={`/tours/${slug}`}>{t('booking-closed-back')}</Link>
        </p>
      </div>
    );
  }

  // Spec 0040: los precios del día de la salida, los mismos que cobra el servidor.
  const pricing = await getTourPricingForDay(tour.id, crDate(new Date(instance.starts_at)));

  const tourName = locale === 'es' ? tour.name_es : tour.name_en;

  // Spec 0034: sin datos del operador, o sin la información del tour que prometen los términos,
  // no se vende. Las acciones lo vuelven a verificar; acá solo se evita mostrar un formulario inútil.
  // Spec 0040: un día sin ningún precio no se vende.
  if (
    !isOperatorIdentityComplete(operator) ||
    pricing.length === 0 ||
    !isTourBookable(tour, pricing)
  ) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{tourName}</h1>
        <p>{t('sales-not-enabled')}</p>
      </div>
    );
  }

  const dateLabel = new Date(instance.starts_at).toLocaleString(
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

  // Spec 0042: la etiqueta de turno de la salida (sol o luna) según su hora en Costa Rica.
  const shift = shiftOfTime(crClockTime(new Date(instance.starts_at)));

  const summary: PurchaseSummaryInfo = {
    tourName,
    dateLabel,
    meetingPoint: locale === 'es' ? tour.meeting_point_es : tour.meeting_point_en,
    sellerLegalName: operator.legalName,
    sellerTaxId: operator.taxId,
    brand: operator.brand,
    toleranceMinutes,
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <ShiftBadge shift={shift} className={styles.shift} />
        <h1 className={styles.title}>{t('title')}</h1>
        <div className={styles.summary}>
          <p>
            <strong>{t('tour-label')}:</strong> {tourName}
          </p>
          <p>
            <strong>{t('date-label')}:</strong> {dateLabel}
          </p>
        </div>
      </header>
      {/* Spec 0029: con el flag, reserva sin cargo y cobro al confirmarse la salida. */}
      {isDeferredChargeEnabled() ? (
        <DeferredCheckoutForm instanceId={instanceId} pricing={pricing} summary={summary} />
      ) : (
        <CheckoutForm instanceId={instanceId} pricing={pricing} summary={summary} />
      )}
    </div>
  );
}
