import {
  MINIMUM_CUTOFF_HOURS,
  MINIMUM_NOTICE_HOURS,
  MINIMUM_NOTICE_MARGIN_MINUTES,
  MINIMUM_TRAY_HORIZON_HOURS,
} from '@shared/constants/operations';
import { MS_PER_HOUR, MS_PER_MINUTE } from '@/lib/dates/durations';

// El mínimo de una salida del cobro inmediato, tal como lo ve el panel (spec 0035). El proceso
// del worker la resuelve cuando faltan 25 horas; antes de eso el staff puede mantenerla o
// cancelarla desde la bandeja.

const HOUR_MS = MS_PER_HOUR;
const NOTICE_MS = MINIMUM_NOTICE_HOURS * HOUR_MS + MINIMUM_NOTICE_MARGIN_MINUTES * MS_PER_MINUTE;

export type MinimumInput = {
  startsAt: string;
  minParticipants: number;
  /** Cupos cobrados (capacity_reserved). */
  seats: number;
  resolvedAt: string | null;
  /** La salida tiene reservas del cobro diferido: la decide el motor del spec 0033. */
  deferredFlow: boolean;
  now: Date;
};

export type MinimumView = {
  minimum: number;
  seats: number;
  /** Aparece en la bandeja: bajo el mínimo, sin resolver, con el corte dentro de 72 horas. */
  needsDecision: boolean;
  /** Todavía se puede cancelar por mínimo: faltan más de 24 horas (y el margen del aviso). */
  canCancelForMinimum: boolean;
  /** El mínimo ya se resolvió: la salida se mantuvo o lo alcanzó. */
  resolved: boolean;
  /** Corte en que el proceso la resuelve solo (inicio menos 25 horas). */
  cutoffAt: string;
};

export function minimumView(input: MinimumInput): MinimumView {
  const startsMs = new Date(input.startsAt).getTime();
  const nowMs = input.now.getTime();
  const cutoffMs = startsMs - MINIMUM_CUTOFF_HOURS * HOUR_MS;
  const unresolved = input.resolvedAt === null && !input.deferredFlow;
  const below = input.minParticipants > 1 && input.seats < input.minParticipants;

  return {
    minimum: input.minParticipants,
    seats: input.seats,
    needsDecision:
      unresolved &&
      below &&
      startsMs > nowMs &&
      cutoffMs <= nowMs + MINIMUM_TRAY_HORIZON_HOURS * HOUR_MS,
    canCancelForMinimum: unresolved && startsMs - nowMs > NOTICE_MS,
    resolved: input.resolvedAt !== null,
    cutoffAt: new Date(cutoffMs).toISOString(),
  };
}
