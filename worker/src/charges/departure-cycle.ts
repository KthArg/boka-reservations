import type { ChargeableBooking } from './departure-repository.js';
import { BelowMinimumPolicy, type BelowMinimumPolicyValue } from './minimum-policy.js';

// Decisiones puras del ciclo de cobro de una salida (spec 0033 §5.3 a §5.5). Sin DB ni red: el
// job trae los datos, esto decide y el job ejecuta. Igual que charges/decide.ts, mantenerlo puro
// es lo que permite testear cada fila de la tabla sin montar OnvoPay.

/** EARLY_CANCEL_FLOOR_HOURS del spec: no se cancela una salida lejana; se cierra y se reintenta. */
const EARLY_CANCEL_FLOOR_MS = 72 * 60 * 60 * 1000;

/**
 * Aviso que prometen los términos para cancelar una salida por mínimo (cláusula del mínimo de
 * participantes): al menos 24 horas antes del inicio. Con menos, la salida ya no se puede cancelar
 * por mínimo (la guarda de resolve_departure_minimum, …055). Espeja a cancel_departure (…049).
 */
export const MINIMUM_NOTICE_MS = 24 * 60 * 60 * 1000;

/**
 * Margen sobre las 24 horas para cancelar sin una persona delante: el correo sale al minuto
 * siguiente y tiene que llegar con 24 horas o más. El mismo de cancel_departure (…049).
 */
const AUTO_CANCEL_NOTICE_MS = MINIMUM_NOTICE_MS + 10 * 60 * 1000;

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
  /** Decide una persona, desde la bandeja de Salidas: confirmarla o cancelarla. */
  StaffDecision: 'staff_decision',
  /** Política `auto_cancel` (spec 0045): la salida se cancela sola, con el aviso de 24 horas. */
  AutoCancel: 'auto_cancel',
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
 * Qué hacer después de soltar. Lejos de la salida, una foto de hoy no justifica molestar a nadie
 * y el ciclo se cierra para reabrirse más cerca de la fecha. Más cerca manda la política del
 * negocio (spec 0045): con `staff_decides` decide una persona, nunca el motor; con `auto_cancel`
 * el motor cancela, pero solo si no quedó ningún cupo cobrado ni autorizado y el aviso de 24
 * horas todavía llega. En cualquier otro caso decide una persona.
 */
export function decideRelease(
  input: CycleInput,
  policy: BelowMinimumPolicyValue = BelowMinimumPolicy.StaffDecides,
): ReleaseOutcomeValue {
  const untilStartMs = input.startsAt.getTime() - input.now.getTime();
  if (untilStartMs > EARLY_CANCEL_FLOOR_MS) return ReleaseOutcome.Close;
  const nothingHeld = input.captured === 0 && input.authorized === 0;
  const noticeArrives = untilStartMs > AUTO_CANCEL_NOTICE_MS;
  if (policy === BelowMinimumPolicy.AutoCancel && nothingHeld && noticeArrives) {
    return ReleaseOutcome.AutoCancel;
  }
  return ReleaseOutcome.StaffDecision;
}

/** Con menos de 24 horas ya no se puede cancelar por mínimo: el aviso prometido no llega. */
export function isTooLateToCancelForMinimum(input: CycleInput): boolean {
  return input.startsAt.getTime() - input.now.getTime() < MINIMUM_NOTICE_MS;
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
