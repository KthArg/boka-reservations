import { createClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import { buildInstanceDates } from './tour-instance-dates.js';

const LOOKAHEAD_DAYS = 90;

type ScheduleRow = {
  id: string;
  tour_id: string;
  day_of_week: number;
  start_time: string;
  capacity: number;
  valid_from: string | null;
  valid_until: string | null;
};

// Día calendario de Costa Rica de un instante (worker self-contained: espejo de
// web/lib/dates/cr-date.ts). La vigencia del horario la define el operador en días CR.
const BUSINESS_TIMEZONE = 'America/Costa_Rica';
function crDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE });
}

// spec 0028 (C6): valid_from/valid_until eran columnas muertas — el operador seteaba
// valid_until esperando cerrar la temporada y las salidas se seguían generando 90 días.
function withinValidity(startsAtIso: string, sch: ScheduleRow): boolean {
  const day = crDateOf(startsAtIso);
  if (sch.valid_from != null && day < sch.valid_from) return false;
  if (sch.valid_until != null && day > sch.valid_until) return false;
  return true;
}

type TourRow = {
  id: string;
  duration_minutes: number;
};

export async function generateTourInstances(): Promise<void> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const [{ data: schedules, error: schErr }, { data: tours, error: tourErr }] = await Promise.all([
    db
      .from('tour_schedules')
      .select('id, tour_id, day_of_week, start_time, capacity, valid_from, valid_until')
      .eq('active', true),
    db.from('tours').select('id, duration_minutes').eq('status', 'active'),
  ]);

  if (schErr) throw new Error(`Error al leer schedules: ${schErr.message}`);
  if (tourErr) throw new Error(`Error al leer tours: ${tourErr.message}`);
  if (!schedules?.length) {
    console.log('[generate-tour-instances] sin schedules activos');
    return;
  }

  const durationByTour = new Map<string, number>(
    (tours as TourRow[]).map((t) => [t.id, t.duration_minutes]),
  );

  const activeTourIds = new Set((tours as TourRow[]).map((t) => t.id));
  const fromDate = new Date();
  let totalInserted = 0;

  for (const sch of schedules as ScheduleRow[]) {
    if (!activeTourIds.has(sch.tour_id)) continue;
    const durationMinutes = durationByTour.get(sch.tour_id);
    if (durationMinutes === undefined) continue;

    const dates = buildInstanceDates(
      { ...sch, duration_minutes: durationMinutes },
      fromDate,
      LOOKAHEAD_DAYS,
    );
    if (dates.length === 0) continue;

    const rows = dates
      .filter((d) => withinValidity(d.starts_at, sch))
      .map((d) => ({
        tour_id: sch.tour_id,
        schedule_id: sch.id,
        starts_at: d.starts_at,
        ends_at: d.ends_at,
        capacity_total: sch.capacity,
      }));
    if (rows.length === 0) continue;

    const { error, count } = await db.from('tour_instances').upsert(rows, {
      onConflict: 'schedule_id,starts_at',
      ignoreDuplicates: true,
      count: 'exact',
    });

    if (error) throw new Error(`Error upsert schedule ${sch.id}: ${error.message}`);
    totalInserted += count ?? 0;
  }

  console.log(`[generate-tour-instances] done — ${totalInserted} instancias nuevas`);
}
