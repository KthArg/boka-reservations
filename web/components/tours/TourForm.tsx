'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { createTour, updateTour } from '@/lib/tours/actions';
import { useSubmitWithoutReset } from '@/lib/forms/use-submit-without-reset';
import { hasInvalidNumbers } from '@/lib/tours/number-rules';
import { hasPricingErrors } from '@/lib/tours/validation';
import { ChargeTiming } from '@shared/constants/tours';
import type {
  ActionResult,
  FieldErrors,
  PricingRow,
  ScheduleRow,
  TourBasicValues,
  TourWithDetails,
} from '@/lib/tours/types';
import { toBasicValues, toPricingRows, toScheduleRows } from './form-values';
import TourBasicInfoSection from './TourBasicInfoSection';
import TourDetailsSection from './TourDetailsSection';
import TourPublishedInfoSection from './TourPublishedInfoSection';
import TourMinimumPolicyField from './TourMinimumPolicyField';
import TourChargeTimingField from './TourChargeTimingField';
import PricingEditor from './PricingEditor';
import ScheduleEditor from './ScheduleEditor';
import styles from './TourForm.module.css';

type Props = { defaultValues?: TourWithDetails; defaultChargeLeadHours: number };

const EMPTY_ERRORS: FieldErrors = {};

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
  const [basic, setBasic] = useState<TourBasicValues>(() => toBasicValues(defaultValues));
  const setBasicField = (name: keyof TourBasicValues, value: string) =>
    setBasic((b) => ({ ...b, [name]: value }));
  const [chargeTiming, setChargeTiming] = useState<ChargeTiming>(
    defaultValues?.charge_timing ?? ChargeTiming.BeforeDeparture,
  );
  const [chargeLeadHours, setChargeLeadHours] = useState(
    defaultValues?.charge_lead_hours ? String(defaultValues.charge_lead_hours) : '',
  );

  const formRef = useRef<HTMLFormElement>(null);
  const submitToServer = useSubmitWithoutReset(formAction);
  const [showNumberErrors, setShowNumberErrors] = useState(false);
  // Precios y capacidades se validan antes de enviar: el campo deja borrar libremente y un
  // valor vacío o inválido llega como NaN, que JSON convertiría en null.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (hasInvalidNumbers(pricing, schedules) || hasPricingErrors(pricing)) {
      event.preventDefault();
      setShowNumberErrors(true);
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector('[aria-invalid="true"], [data-pricing-error]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
      return;
    }
    submitToServer(event);
  };

  useEffect(() => {
    if (state?.success === false && formRef.current) {
      formRef.current
        .querySelector('[data-error]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [state]);

  return (
    <form ref={formRef} onSubmit={handleSubmit} className={styles.form}>
      <input type="hidden" name="pricing" value={JSON.stringify(pricing)} />
      <input type="hidden" name="schedules" value={JSON.stringify(schedules)} />

      {errors._form?.map((e) => (
        <p key={e} className={styles.formError} data-error>
          {e}
        </p>
      ))}

      {/* Spec 0042: textos, precios y horarios a la izquierda; la ficha y las reglas a la derecha. */}
      <div className={styles.mainCol}>
        <TourBasicInfoSection values={basic} onChange={setBasicField} errors={errors} />
        <TourPublishedInfoSection defaultValues={defaultValues} errors={errors} />
        <PricingEditor
          value={pricing}
          onChange={setPricing}
          errors={errors.pricing as string[] | undefined}
          showErrors={showNumberErrors}
        />
        <ScheduleEditor value={schedules} onChange={setSchedules} showErrors={showNumberErrors} />
      </div>

      <div className={styles.sideCol}>
        <TourDetailsSection values={basic} onChange={setBasicField} errors={errors} />
        <TourMinimumPolicyField />
        <TourChargeTimingField
          timing={chargeTiming}
          leadHours={chargeLeadHours}
          defaultLeadHours={defaultChargeLeadHours}
          onTimingChange={setChargeTiming}
          onLeadHoursChange={setChargeLeadHours}
          errors={errors.charge_lead_hours}
        />
      </div>

      <div className={styles.footer}>
        <button type="submit" disabled={isPending} className={styles.submitBtn}>
          {isPending ? '...' : isEdit ? t('submit-update') : t('submit-create')}
        </button>
      </div>
    </form>
  );
}
