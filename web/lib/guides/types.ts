/** Idiomas soportados por la app (mismos que next-intl routing). */
export type Locale = 'es' | 'en';

/** Guía asignable (usuario con role='guide' activo). */
export type AssignableGuide = {
  id: string;
  fullName: string;
};

/**
 * Estado del cobro del mínimo de una salida (spec 0033), tal como lo ve el panel.
 */
export const DepartureChargeState = {
  /** El ciclo todavía no se abrió, o se cerró sin resolver por lejanía. */
  Idle: 'idle',
  /** Ciclo abierto: se está autorizando y todavía hay plazo. */
  Charging: 'charging',
  /** Venció el plazo sin alcanzar el mínimo y decide una persona. */
  AwaitingDecision: 'awaiting_decision',
  /** El mínimo se resolvió: alcanzado, confirmado o cancelado. */
  Resolved: 'resolved',
} as const;

export type DepartureChargeStateValue =
  (typeof DepartureChargeState)[keyof typeof DepartureChargeState];

/** El cobro del mínimo de una salida, para mostrarlo y para decidir sobre él. */
export type DepartureCharge = {
  state: DepartureChargeStateValue;
  /** Cupos con la plata ya retenida o cobrada. */
  authorizedTickets: number;
  /** Mínimo de la foto del disparo, o el del tour si el ciclo no se abrió. */
  minimum: number;
  /** Hasta cuándo hay plazo antes de que decida una persona. */
  deadline: string | null;
  resolution: string | null;
};

/** Una salida futura en el panel de Salidas, con su guía asignado (si hay). */
export type Departure = {
  id: string;
  tourName: string;
  startsAt: string;
  capacityTotal: number;
  confirmedTickets: number;
  assignedGuide: AssignableGuide | null;
  charge: DepartureCharge;
};

/** Resumen de una salida asignada, para la vista pública del guía. */
export type GuideUpcomingTour = {
  instanceId: string;
  tourName: string;
  startsAt: string;
  meetingPoint: string;
  passengerCount: number;
};
