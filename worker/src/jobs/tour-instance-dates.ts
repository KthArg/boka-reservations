const CR_UTC_OFFSET = '-06:00';
const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;
const HHMM_LEN = 5; // longitud de "HH:MM"

export type ScheduleInput = {
  id: string;
  tour_id: string;
  day_of_week: number;
  start_time: string;
  capacity: number;
  duration_minutes: number;
};

export type InstanceDate = { starts_at: string; ends_at: string };

export function buildInstanceDates(
  schedule: ScheduleInput,
  fromDate: Date,
  days: number,
): InstanceDate[] {
  const results: InstanceDate[] = [];

  for (let i = 0; i < days; i++) {
    const candidate = new Date(fromDate.getTime() + i * MS_PER_DAY);

    if (getDayOfWeekInCR(candidate) !== schedule.day_of_week) continue;

    const dateStr = formatDateInCR(candidate);
    const timeHHMM = schedule.start_time.slice(0, HHMM_LEN);
    const starts_at = `${dateStr}T${timeHHMM}:00${CR_UTC_OFFSET}`;
    const ends_at = new Date(
      new Date(starts_at).getTime() + schedule.duration_minutes * MS_PER_MINUTE,
    ).toISOString();

    results.push({ starts_at, ends_at });
  }

  return results;
}

function getDayOfWeekInCR(utcDate: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Costa_Rica',
    weekday: 'short',
  }).formatToParts(utcDate);

  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday ?? 'Sun'] ?? 0;
}

function formatDateInCR(utcDate: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(utcDate);
}
