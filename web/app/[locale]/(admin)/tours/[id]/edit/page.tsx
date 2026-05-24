import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getTourWithDetails } from '@/lib/tours/repository';
import { archiveTour, reactivateTour } from '@/lib/tours/actions';
import { TourStatus } from '@shared/constants/enums';
import TourForm from '@/components/tours/TourForm';
import styles from './edit.module.css';

type Props = { params: Promise<{ id: string }> };

export default async function EditTourPage({ params }: Props) {
  const { id } = await params;
  const [tour, t] = await Promise.all([getTourWithDetails(id), getTranslations('tours')]);
  if (!tour) notFound();

  const isActive = tour.status === TourStatus.Active;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          {t('edit-tour')}: {tour.name_es}
        </h1>
        <form
          action={isActive ? archiveTour.bind(null, tour.id) : reactivateTour.bind(null, tour.id)}
        >
          <button type="submit" className={isActive ? styles.archiveBtn : styles.reactivateBtn}>
            {isActive ? t('archive') : t('reactivate')}
          </button>
        </form>
      </div>
      <TourForm defaultValues={tour} />
    </div>
  );
}
