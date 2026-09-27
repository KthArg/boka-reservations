'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { createTour, updateTour } from '@/lib/tours/actions';
import { slugify } from '@/lib/tours/validation';
import { TicketType, TourDifficulty } from '@shared/constants/enums';
import { ChargeTiming } from '@shared/constants/tours';
import type {
  ActionResult,
  FieldErrors,
  PricingRow,
  ScheduleRow,
  TourBasicValues,
  TourWithDetails,
} from '@/lib/tours/types';
import TourBasicInfoSection from './TourBasicInfoSection';
import TourMinimumPolicyField from './TourMinimumPolicyField';
import TourChargeTimingField from './TourChargeTimingField';
import PricingEditor from './PricingEditor';
import ScheduleEditor from './ScheduleEditor';
import styles from './TourForm.module.css';

type Props = { defaultValues?: TourWithDetails; defaultChargeLeadHours: number };

const EMPTY_ERRORS: FieldErrors = {};

function toPricingRows(pricing: TourWithDetails['pricing']): PricingRow[] {
  return pricing.map((p) => ({
    id: p.id,
    ticket_type: p.ticket_type as TicketType,
    price_usd: Number(p.price_usd),
    season_label: p.season_label,
    valid_from: p.valid_from,
    valid_until: p.valid_until,
    active: p.active,
  }));
}

function toScheduleRows(schedules: TourWithDetails['schedules']): ScheduleRow[] {
  return schedules.map((s) => ({
    id: s.id,
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    capacity: s.capacity,
    valid_from: s.valid_from,
    valid_until: s.valid_until,
    active: s.active,
  }));
}

export default function TourForm({ defaultValues, defaultChargeLeadHours }: Props) {
  const t = useTranslations('tours');
  const isEdit = !!defaultValues;

  const action = isEdit ? updateTour.bind(null, defaultValues!.id) : createTour;
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    action,
    null,
  );
  const rawErrors = (state?.success === false ? state.errors : EMPTY_ERRORS) as FieldErrors;
  // Las actions devuelven CÓDIGOS (`tour_*`, spec 0028); acá se traducen. Los mensajes
  // de Zod (validación por campo) siguen siendo texto y se muestran tal cual.
  const translate = (msg: string) => (msg.startsWith('tour_') ? t(`errors.${msg}`) : msg);
  const errors = Object.fromEntries(
    Object.entries(rawErrors).map(([field, msgs]) => [field, msgs?.map(translate)]),
  ) as FieldErrors;

  const [pricing, setPricing] = useState<PricingRow[]>(
    defaultValues ? toPricingRows(defaultValues.pricing) : [],
  );
  const [schedules, setSchedules] = useState<ScheduleRow[]>(
    defaultValues ? toScheduleRows(defaultValues.schedules) : [],
  );

  // Campos básicos como estado controlado: React 19 hace form.reset() tras la action y borraría
  // los inputs no controlados al fallar una validación (se perdía lo tipeado). El estado sobrevive
  // al re-render, igual que pricing/schedules.
  const [basic, setBasic] = useState<TourBasicValues>(() => ({
    name_es: defaultValues?.name_es ?? '',
    name_en: defaultValues?.name_en ?? '',
    description_es: defaultValues?.description_es ?? '',
    description_en: defaultValues?.description_en ?? '',
    meeting_point_es: defaultValues?.meeting_point_es ?? '',
    meeting_point_en: defaultValues?.meeting_point_en ?? '',
    includes_es: defaultValues?.includes_es ?? '',
    includes_en: defaultValues?.includes_en ?? '',
    difficulty: defaultValues?.difficulty ?? TourDifficulty.Easy,
    duration_minutes: defaultValues ? String(defaultValues.duration_minutes) : '',
    min_participants: defaultValues ? String(defaultValues.min_participants) : '',
    max_capacity: defaultValues ? String(defaultValues.max_capacity) : '',
    slug: defaultValues?.slug ?? '',
    cover_image_url: defaultValues?.cover_image_url ?? '',
  }));
  const setBasicField = (name: keyof TourBasicValues, value: string) =>
    setBasic((b) => ({ ...b, [name]: value }));
  const [autoCancel, setAutoCancel] = useState(defaultValues?.auto_cancel_below_minimum ?? false);
  const [chargeTiming, setChargeTiming] = useState<ChargeTiming>(
    defaultValues?.charge_timing ?? ChargeTiming.BeforeDeparture,
  );
  const [chargeLeadHours, setChargeLeadHours] = useState(
    defaultValues?.charge_lead_hours ? String(defaultValues.charge_lead_hours) : '',
  );

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success === false && formRef.current) {
      formRef.current
        .querySelector('[data-error]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={styles.form}>
      <input type="hidden" name="pricing" value={JSON.stringify(pricing)} />
      <input type="hidden" name="schedules" value={JSON.stringify(schedules)} />

      {errors._form?.map((e) => (
        <p key={e} className={styles.formError} data-error>
          {e}
        </p>
      ))}

      <TourBasicInfoSection values={basic} onChange={setBasicField} errors={errors} />
      <TourMinimumPolicyField checked={autoCancel} onChange={setAutoCancel} />
      <TourChargeTimingField
        timing={chargeTiming}
        leadHours={chargeLeadHours}
        defaultLeadHours={defaultChargeLeadHours}
        onTimingChange={setChargeTiming}
        onLeadHoursChange={setChargeLeadHours}
        errors={errors.charge_lead_hours}
      />
      <PricingEditor
        value={pricing}
        onChange={setPricing}
        errors={errors.pricing as string[] | undefined}
      />
      <ScheduleEditor value={schedules} onChange={setSchedules} />

      <div className={styles.footer}>
        <button type="submit" disabled={isPending} className={styles.submitBtn}>
          {isPending ? '...' : isEdit ? t('submit-update') : t('submit-create')}
        </button>
      </div>
    </form>
  );
}
