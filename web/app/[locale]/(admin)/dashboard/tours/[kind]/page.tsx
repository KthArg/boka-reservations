import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getFixedTourWithDetails } from '@/lib/tours/repository';
import { getBusinessSettings } from '@/lib/settings/repository';
import { getCurrentUser } from '@/lib/auth/server';
import { isTourKind, TourStatus, UserRole } from '@shared/constants/enums';
import TourForm from '@/components/tours/TourForm';
import { TourStatusButton } from '@/components/tours/TourStatusButton';
import styles from './tour.module.css';

type Props = { params: Promise<{ kind: string }>; searchParams: Promise<{ saved?: string }> };

/** Formulario de uno de los dos tours fijos (spec 0047): `/dashboard/tours/day` y `/night`. */
export default async function FixedTourPage({ params, searchParams }: Props) {
  const [{ kind }, { saved }] = await Promise.all([params, searchParams]);
  if (!isTourKind(kind)) notFound();

  const [tour, t, settings, user] = await Promise.all([
    getFixedTourWithDetails(kind),
    getTranslations('tours'),
    getBusinessSettings(),
    getCurrentUser(),
  ]);
  if (!tour) notFound();

  const paused = tour.status === TourStatus.Paused;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>{t(`kind-${kind}`)}</p>
          <h1 className={styles.title}>{tour.name_es}</h1>
        </div>
        <div className={styles.status}>
          <span role="status" className={paused ? styles.badgePaused : styles.badgeActive}>
            {t(paused ? 'status-paused' : 'status-active')}
          </span>
          {user?.role === UserRole.Admin ? <TourStatusButton kind={kind} paused={paused} /> : null}
        </div>
      </div>
      {saved ? (
        <p role="status" className={styles.saved}>
          {t('saved-notice')}
        </p>
      ) : null}
      {/* La key cambia con cada guardado: el formulario se rearma con los ids de las filas nuevas
          (si no, un segundo guardado las borraría y volvería a insertar). */}
      <TourForm
        key={`${tour.id}:${tour.updated_at}`}
        defaultValues={tour}
        defaultChargeLeadHours={settings.default_charge_lead_hours}
      />
    </div>
  );
}
