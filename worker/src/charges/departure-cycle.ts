import type { ChargeableBooking } from './departure-repository.js';

// Decisiones puras del ciclo de cobro de una salida (spec 0033 §5.3 a §5.5). Sin DB ni red: el
// job trae los datos, esto decide y el job ejecuta. Igual que charges/decide.ts, mantenerlo puro
// es lo que permite testear cada fila de la tabla sin montar OnvoPay.

/** EARLY_CANCEL_FLOOR_HOURS del spec: no se cancela una salida lejana; se cierra y se reintenta. */
const EARLY_CANCEL_FLOOR_MS = 72 * 60 * 60 * 1000;

/** Marcas de claim o de captura más viejas que esto quedaron de un proceso que murió. */
export const STALE_MARK_MS = 15 * 60 * 1000;

export const CycleAction = {
  /** Faltan autorizaciones por intentar o plazos por correr: no se toca la plata. */
  Wait: 'wait',
  /** Los cupos autorizados alcanzan el mínimo: se capturan las autorizaciones. */
  Capture: 'capture',
  /** Venció el plazo sin alcanzar el mínimo: se sueltan las autorizaciones. */
  Release: 'release',
} as const;

export type CycleActionValue = (typeof CycleAction)[keyof typeof CycleAction];

/** Qué hacer con la salida una vez soltadas las autorizaciones (§5.5). */
export const ReleaseOutcome = {
  /** Falta mucho para la salida: se cierra el ciclo y se reintenta más cerca de la fecha. */
  Close: 'close',
  /** Se cancela sola: el tour lo permite y no hay plata cobrada. */
  AutoCancel: 'auto_cancel',
  /** Decide una persona: el tour no cancela solo, o hay plata cobrada de por medio. */
  StaffDecision: 'staff_decision',
} as const;

export type ReleaseOutcomeValue = (typeof ReleaseOutcome)[keyof typeof ReleaseOutcome];

export type CycleInput = {
  /** Cupos ya cobrados de la salida. */
  captured: number;
  /** Cupos autorizados, incluidos los capturados. */
  authorized: number;
  /** Mínimo de la foto del disparo. */
  minimum: number;
  deadline: Date;
  startsAt: Date;
  autoCancelBelowMinimum: boolean;
  now: Date;
};

/**
 * La decisión central del spec: **todo o nada**. Mientras el plazo no venza y queden intentos, no
 * se mueve plata; si los cupos autorizados alcanzan el mínimo, se captura todo; si el plazo venció
 * sin alcanzarlo, se suelta todo, que no cuesta nada.
 */
export function decideCycle(input: CycleInput): CycleActionValue {
  if (input.authorized >= input.minimum) return CycleAction.Capture;
  // Se espera al plazo completo aunque ninguna reserva tenga reintentos por delante: hasta que
  // venza pueden entrar reservas nuevas, que es justamente para lo que existe la ventana (§5.3).
  if (input.deadline > input.now) return CycleAction.Wait;
  return CycleAction.Release;
}

/**
 * Qué hacer después de soltar. Nunca se cancela sola una salida con plata cobrada: devolverla es
 * una decisión con consecuencias y la toma una persona (§5.5).
 */
export function decideRelease(input: CycleInput): ReleaseOutcomeValue {
  const farFromDeparture = input.startsAt.getTime() - input.now.getTime() > EARLY_CANCEL_FLOOR_MS;
  if (farFromDeparture) return ReleaseOutcome.Close;
  if (input.captured > 0) return ReleaseOutcome.StaffDecision;
  return input.autoCancelBelowMinimum ? ReleaseOutcome.AutoCancel : ReleaseOutcome.StaffDecision;
}

/**
 * Red terminal (§5.5): sin decisión del staff, la salida no puede llegar a su fecha sin resolver.
 * Con plata cobrada no se cancela sola: se alerta y espera a una persona.
 */
export function shouldForceResolve(input: CycleInput, marginMs: number): boolean {
  return input.startsAt.getTime() - input.now.getTime() <= marginMs;
}

/** Una marca (claim o captura) de un proceso que murió deja la reserva trabada; se limpia. */
export function isStaleMark(mark: Date | null, now: Date): boolean {
  return mark !== null && now.getTime() - mark.getTime() > STALE_MARK_MS;
}

/**
 * Reintento disponible. `charge_next_attempt_at` en null significa dos cosas distintas: una
 * reserva que nunca falló, y una que agotó sus reintentos. Sin el chequeo de `charge_attempts`,
 * una tarjeta definitivamente rechazada se reconfirmaría cada ciclo y el turista recibiría un
 * aviso de rechazo cada vez.
 */
export function canAttempt(booking: ChargeableBooking, now: Date): boolean {
  if (booking.charge_next_attempt_at !== null) {
    return new Date(booking.charge_next_attempt_at) <= now;
  }
  return booking.charge_attempts === 0;
}
