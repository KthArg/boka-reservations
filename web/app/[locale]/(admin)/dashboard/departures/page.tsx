import { getTranslations } from 'next-intl/server';
import { listGuides, listUpcomingDepartures } from '@/lib/guides/repository';
import { formatOperatorDateTime } from '@/lib/booking/today-range';
import { GuideAssigner } from './GuideAssigner';
import { ChargeStatus } from './ChargeStatus';
import { DecisionTray } from './DecisionTray';
import styles from './departures.module.css';

export default async function SalidasPage() {
  const t = await getTranslations('guides');
  const tCharge = await getTranslations('departures');
  const [departures, guides] = await Promise.all([listUpcomingDepartures(), listGuides()]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('departures-title')}</h1>
      </div>

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
            </tr>
          </thead>
          <tbody>
            {departures.map((dep) => {
              const { date, time } = formatOperatorDateTime(dep.startsAt);
              return (
                <tr key={dep.id} className={styles.row}>
                  <td className={styles.td}>
                    {date} {time}
                  </td>
                  <td className={styles.td}>{dep.tourName}</td>
                  <td className={styles.td}>
                    {dep.confirmedTickets} / {dep.capacityTotal}
                  </td>
                  <td className={styles.td}>
                    <ChargeStatus charge={dep.charge} />
                  </td>
                  <td className={styles.td}>
                    <GuideAssigner
                      instanceId={dep.id}
                      guides={guides}
                      assignedGuideId={dep.assignedGuide?.id ?? null}
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
