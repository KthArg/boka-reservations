import { getTranslations } from 'next-intl/server';
import { Moon, Sun } from 'lucide-react';
import { shiftOfTime } from '@/lib/public/shift';
import { listGuides, listUpcomingDepartures } from '@/lib/guides/repository';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import { GuideAssigner } from './GuideAssigner';
import { ChargeStatus } from './ChargeStatus';
import { DecisionTray } from './DecisionTray';
import { MinimumTray } from './MinimumTray';
import { ReviewTray } from './ReviewTray';
import { GuidelessTray } from './GuidelessTray';
import { needsGuide } from '@/lib/guides/needs-guide';
import { RefundTray } from './RefundTray';
import { CancelDepartureDialog } from './CancelDepartureDialog';
import { listRefundsToResolve, listReviewBookings } from '@/lib/operations/repository';
import styles from './departures.module.css';

export default async function SalidasPage() {
  const t = await getTranslations('guides');
  const tCharge = await getTranslations('departures');
  const tOps = await getTranslations('operations');
  const tPublic = await getTranslations('public');
  const [departures, guides, reviews, refunds] = await Promise.all([
    listUpcomingDepartures(),
    listGuides(),
    listReviewBookings(),
    listRefundsToResolve(),
  ]);

  const now = new Date();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('departures-title')}</h1>
      </div>

      <GuidelessTray departures={departures} guides={guides} now={now} />
      <RefundTray refunds={refunds} />
      <ReviewTray bookings={reviews} />
      <MinimumTray departures={departures} />
      <DecisionTray departures={departures} />

      {departures.length === 0 ? (
        <p className={styles.empty}>{t('departures-empty')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>{t('col-date')}</th>
              <th className={styles.th}>{t('col-tour')}</th>
              <th className={styles.th}>{t('col-passengers')}</th>
              <th className={styles.th}>{tCharge('col-charge')}</th>
              <th className={styles.th}>{t('col-guide')}</th>
              <th className={styles.th}>
                <span className={styles.srOnly}>{tOps('cancel-departure')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {departures.map((dep) => {
              const { date, time } = formatOperatorDateTime(dep.startsAt);
              // Spec 0042: sol o luna según la hora de inicio de la salida.
              const shift = time ? shiftOfTime(time) : null;
              return (
                <tr key={dep.id} className={styles.row}>
                  <td className={styles.td}>
                    <span className={styles.when}>
                      {shift ? (
                        <span
                          className={shift === 'night' ? styles.shiftNight : styles.shiftDay}
                          title={tPublic(`shift-${shift}`)}
                        >
                          {shift === 'night' ? (
                            <Moon aria-hidden="true" size={14} />
                          ) : (
                            <Sun aria-hidden="true" size={14} />
                          )}
                          <span className={styles.srOnly}>{tPublic(`shift-${shift}`)}</span>
                        </span>
                      ) : null}
                      {date} {time}
                    </span>
                  </td>
                  <td className={styles.td}>{dep.tourName}</td>
                  <td className={styles.td}>
                    {dep.confirmedTickets} / {dep.capacityTotal}
                  </td>
                  <td className={styles.td}>
                    <ChargeStatus charge={dep.charge} />
                  </td>
                  <td className={styles.td}>
                    {needsGuide(dep, now) ? (
                      <span className={styles.noGuide}>{t('guideless-mark')}</span>
                    ) : null}
                    <GuideAssigner
                      instanceId={dep.id}
                      guides={guides}
                      assignedGuideId={dep.assignedGuide?.id ?? null}
                    />
                  </td>
                  <td className={styles.td}>
                    <CancelDepartureDialog
                      instanceId={dep.id}
                      canCancelForMinimum={dep.minimum.canCancelForMinimum}
                      minimumResolved={dep.minimum.resolved}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
