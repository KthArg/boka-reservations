// Resultados del cobro manual del panel (spec 0029 §5.11), como claves estables: el botón los
// traduce con `bookings.charge-result-<valor>`.

export const ManualChargeOutcome = {
  Confirmed: 'confirmed',
  Declined: 'declined',
  RequiresAction: 'requires_action',
  Processing: 'processing',
  /** Hay un cobro en curso o su resultado quedó desconocido: lo resuelve watch-charges. */
  InProgress: 'in_progress',
  Review: 'review',
  Mismatch: 'mismatch',
  NotChargeable: 'not_chargeable',
  TooSoon: 'retry_too_soon',
  DepartureUnavailable: 'departure_unavailable',
  RecoveryExpired: 'recovery_expired',
  CardChanged: 'payment_method_changed',
  Failed: 'failed',
  Unauthorized: 'unauthorized',
} as const;

export type ManualChargeOutcomeValue =
  (typeof ManualChargeOutcome)[keyof typeof ManualChargeOutcome];

const START_OUTCOMES: Record<string, ManualChargeOutcomeValue> = {
  not_chargeable: ManualChargeOutcome.NotChargeable,
  retry_too_soon: ManualChargeOutcome.TooSoon,
  departure_unavailable: ManualChargeOutcome.DepartureUnavailable,
  recovery_expired: ManualChargeOutcome.RecoveryExpired,
  payment_method_changed: ManualChargeOutcome.CardChanged,
  // Otro intent quedó pendiente en el medio: no se confirma nada, revisión manual.
  intent_mismatch: ManualChargeOutcome.Review,
};

/** Traduce un outcome de charge_booking_start distinto de 'started'. */
export function outcomeForStart(startOutcome: string): ManualChargeOutcomeValue {
  return START_OUTCOMES[startOutcome] ?? ManualChargeOutcome.Review;
}
