import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';
import { getTourBySlug, getTourPricing, getUpcomingInstances } from '@/lib/public/tours';
import { CheckoutForm } from '@/components/public/CheckoutForm/CheckoutForm';
import styles from './checkout.module.css';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ instance?: string }> };

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { id: slug } = await params;
  const { instance: instanceId } = await searchParams;

  if (!instanceId) notFound();

  const [t, locale, tour] = await Promise.all([
    getTranslations('checkout'),
    getLocale(),
    getTourBySlug(slug),
  ]);

  if (!tour) notFound();

  const [pricing, instances] = await Promise.all([
    getTourPricing(tour.id),
    getUpcomingInstances(tour.id),
  ]);

  const instance = instances.find((i) => i.id === instanceId);
  if (!instance) notFound();

  const tourName = locale === 'es' ? tour.name_es : tour.name_en;

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
      <CheckoutForm instanceId={instanceId} tourName={tourName} pricing={pricing} tourSlug={slug} />
    </div>
  );
}
