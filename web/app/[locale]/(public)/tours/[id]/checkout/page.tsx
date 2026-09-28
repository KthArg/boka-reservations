import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';
import { getTourBySlug, getTourPricing, getUpcomingInstances } from '@/lib/public/tours';
import { isTourBookable } from '@/lib/public/tour-bookable';
import { isDeferredChargeEnabled } from '@/lib/booking/deferred-flag';
import { getNoShowToleranceMinutes, getOperatorIdentity } from '@/lib/operator/repository';
import { isOperatorIdentityComplete } from '@/lib/operator/types';
import { CheckoutForm } from '@/components/public/CheckoutForm/CheckoutForm';
import { DeferredCheckoutForm } from '@/components/public/CheckoutForm/DeferredCheckoutForm';
import type { PurchaseSummaryInfo } from '@/components/public/CheckoutForm/PurchaseSummary';
import styles from './checkout.module.css';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ instance?: string }> };

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { id: slug } = await params;
  const { instance: instanceId } = await searchParams;

  if (!instanceId) notFound();

  const [t, locale, tour, operator, toleranceMinutes] = await Promise.all([
    getTranslations('checkout'),
    getLocale(),
    getTourBySlug(slug),
    getOperatorIdentity(),
    getNoShowToleranceMinutes(),
  ]);

  if (!tour) notFound();

  const [pricing, instances] = await Promise.all([
    getTourPricing(tour.id),
    getUpcomingInstances(tour.id),
  ]);

  const instance = instances.find((i) => i.id === instanceId);
  if (!instance) notFound();

  const tourName = locale === 'es' ? tour.name_es : tour.name_en;

  // Spec 0034: sin datos del operador, o sin la información del tour que prometen los términos,
  // no se vende. Las acciones lo vuelven a verificar; acá solo se evita mostrar un formulario inútil.
  if (!isOperatorIdentityComplete(operator) || !isTourBookable(tour, pricing)) {
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
