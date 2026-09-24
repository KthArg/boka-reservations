import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnvopayChargeClient } from './onvopay.js';
import {
  ReleaseOutcome,
  decideRelease,
  shouldForceResolve,
  type CycleInput,
} from './departure-cycle.js';
import type { DepartureCandidate } from './departure-repository.js';
import {
  DepartureResolution,
  closeDepartureCharge,
  departureSeatCounts,
  resolveDepartureMinimum,
} from './departure-rpc.js';
import { captureAll, releaseAll } from './departure-settle.js';
import { alertCharge } from './alerts.js';

// Cierre del ciclo del mínimo (spec 0033 §5.4 y §5.5): con los cupos autorizados a la vista, la
// salida se captura entera o se suelta entera. Soltar no cuesta nada; reembolsar un cobro sí.

/** MINIMUM_RESOLUTION_MARGIN_HOURS del spec: la red terminal corre a 3 h de la salida. */
export const RESOLUTION_MARGIN_MS = 3 * 60 * 60 * 1000;

const MSG_FORCED = '[charge-departures] salida sin resolver cerca de su fecha';
const MSG_MONEY_HELD = '[charge-departures] salida bajo el mínimo con plata cobrada';

export async function captureDeparture(
  db: SupabaseClient,
  onvopay: OnvopayChargeClient,
  departure: DepartureCandidate,
): Promise<void> {
  // Recuento después del descarte (§5.6): si entre la evaluación y la captura un turista reclamó
  // su cancelación y la salida dejó de alcanzar el mínimo, no se captura nada. Capturar a los
  // demás dejaría plata cobrada en una salida que ya no sale.
  const before = await cycleInput(db, departure, new Date());
  if (before.authorized < before.minimum) return;

  // La resolución espera a que todas las capturas terminen (§5.4).
  if (!(await captureAll(db, onvopay, departure.id))) return;

  const after = await cycleInput(db, departure, new Date());
  if (after.captured >= after.minimum) {
    await resolveDepartureMinimum(db, departure.id, DepartureResolution.Reached);
    return;
  }
  // Una captura falló y la salida quedó bajo el mínimo: hay plata cobrada, decide una persona.
  alertCharge(MSG_MONEY_HELD, 'departure-below-minimum', departure.id, 'error');
}

export async function releaseDeparture(
  db: SupabaseClient,
  onvopay: OnvopayChargeClient,
  departure: DepartureCandidate,
  input: CycleInput,
): Promise<void> {
  await releaseAll(db, onvopay, departure.id);
  const outcome = decideRelease(input);

  if (outcome === ReleaseOutcome.Close) {
    await closeDepartureCharge(db, departure.id);
    return;
  }
  if (outcome === ReleaseOutcome.AutoCancel) {
    await resolveDepartureMinimum(db, departure.id, DepartureResolution.AutoCancelled);
    return;
  }
  if (shouldForceResolve(input, RESOLUTION_MARGIN_MS)) {
    await forceResolve(db, onvopay, departure, input);
  }
}

/** Red terminal (§5.5): con plata cobrada no se cancela sola; se alerta y espera a una persona. */
export async function forceResolve(
  db: SupabaseClient,
  onvopay: OnvopayChargeClient,
  departure: DepartureCandidate,
  input: CycleInput,
): Promise<void> {
  if (input.captured > 0) {
    // Con plata cobrada la salida no se cancela sola, pero las retenciones de las demás reservas
    // sí se sueltan: la salida ya no puede cobrarlas y no hay por qué dejarlas vivas.
    await releaseAll(db, onvopay, departure.id);
    alertCharge(MSG_MONEY_HELD, 'departure-forced-money', departure.id, 'error');
    return;
  }
  await releaseAll(db, onvopay, departure.id);
  await resolveDepartureMinimum(db, departure.id, DepartureResolution.AutoCancelled);
  alertCharge(MSG_FORCED, 'departure-forced', departure.id, 'error');
}

export async function cycleInput(
  db: SupabaseClient,
  departure: DepartureCandidate,
  now: Date,
): Promise<CycleInput> {
  const counts = await departureSeatCounts(db, departure.id);
  return {
    captured: counts.captured,
    authorized: counts.authorized,
    minimum: counts.minimum,
    deadline: new Date(departure.staff_decision_required_at ?? departure.starts_at),
    startsAt: new Date(departure.starts_at),
    autoCancelBelowMinimum: departure.tour.auto_cancel_below_minimum,
    now,
  };
}
