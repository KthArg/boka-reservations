import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnvopayChargeClient } from './onvopay.js';
import {
  ReleaseOutcome,
  decideRelease,
  isTooLateToCancelForMinimum,
  type CycleInput,
} from './departure-cycle.js';
import type { DepartureCandidate } from './departure-repository.js';
import { BelowMinimumPolicy, type BelowMinimumPolicyValue } from './minimum-policy.js';
import {
  AUTO_CANCEL_RESOLVED,
  DepartureResolution,
  autoCancelDepartureMinimum,
  closeDepartureCharge,
  departureSeatCounts,
  resolveDepartureMinimum,
} from './departure-rpc.js';
import { captureAll, releaseAll } from './departure-settle.js';
import { alertCharge } from './alerts.js';

// Cierre del ciclo del mínimo (spec 0033 §5.4 y §5.5): con los cupos autorizados a la vista, la
// salida se captura entera o se suelta entera. Soltar no cuesta nada; reembolsar un cobro sí.

const MSG_TOO_LATE =
  '[charge-departures] salida bajo el mínimo a menos de 24 h: ya no se cancela por mínimo, decide el staff';
const MSG_AWAITING = '[charge-departures] salida bajo el mínimo espera la decisión del staff';
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
  policy: BelowMinimumPolicyValue = BelowMinimumPolicy.StaffDecides,
): Promise<void> {
  const released = await releaseAll(db, onvopay, departure.id);
  // Con algo sin soltar no se cancela sola: una reserva con el cobro ya hecho y sin asentar
  // terminaría cobrada y reembolsada. La foto se relee después de soltar por lo mismo.
  const counts = await departureSeatCounts(db, departure.id);
  // Reloj nuevo: soltar habla con la pasarela y puede tardar.
  const after = {
    ...input,
    captured: counts.captured,
    authorized: counts.authorized,
    now: new Date(),
  };
  const outcome = decideRelease(after, released ? policy : BelowMinimumPolicy.StaffDecides);

  if (outcome === ReleaseOutcome.Close) {
    await closeDepartureCharge(db, departure.id);
    return;
  }
  // Una salida sin cupos vendidos no espera a nadie: la cancela el proceso de las salidas
  // vacías (resolve_immediate_minimum, …057).
  if (counts.sold === 0) return;

  if (outcome === ReleaseOutcome.AutoCancel) {
    const result = await autoCancelDepartureMinimum(db, departure.id);
    if (result === AUTO_CANCEL_RESOLVED) return;
    // Un pago en curso, plata cobrada, aviso que ya no llega o política cambiada: decide una
    // persona.
    console.warn(`[charge-departures] ${departure.id}: no se canceló sola (${result})`);
  }
  // Decide una persona, desde la bandeja de Salidas. Las retenciones ya se soltaron; lo que falta
  // es que alguien lo vea. Una alerta por salida: el job vuelve a pasar por acá cada minuto.
  if (after.captured > 0) {
    alertOnce(MSG_MONEY_HELD, 'departure-below-minimum', departure.id, 'error');
  } else if (isTooLateToCancelForMinimum(input)) {
    alertOnce(MSG_TOO_LATE, 'departure-minimum-too-late', departure.id, 'error');
  } else {
    alertOnce(MSG_AWAITING, 'departure-awaiting-decision', departure.id, 'warning');
  }
}

/**
 * La salida queda esperando a una persona y el job vuelve a pasar por acá cada minuto, quizá por
 * horas: una alerta por salida y por proceso alcanza (la issue de Sentry se agrupa igual).
 */
const alerted = new Set<string>();

function alertOnce(
  message: string,
  fingerprint: string,
  departureId: string,
  level: 'warning' | 'error',
): void {
  const key = `${fingerprint}:${departureId}`;
  if (alerted.has(key)) return;
  alerted.add(key);
  alertCharge(message, fingerprint, departureId, level);
}

/** Solo para tests: el registro de alertas es por proceso. */
export function resetDepartureAlertsForTest(): void {
  alerted.clear();
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
    now,
  };
}
