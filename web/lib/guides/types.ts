/** Idiomas soportados por la app (mismos que next-intl routing). */
export type Locale = 'es' | 'en';

/** Guía asignable (usuario con role='guide' activo). */
export type AssignableGuide = {
  id: string;
  fullName: string;
};

/** Una salida futura en el panel de Salidas, con su guía asignado (si hay). */
export type Departure = {
  id: string;
  tourName: string;
  startsAt: string;
  capacityTotal: number;
  confirmedTickets: number;
  assignedGuide: AssignableGuide | null;
};

/** Resumen de una salida asignada, para la vista pública del guía. */
export type GuideUpcomingTour = {
  instanceId: string;
  tourName: string;
  startsAt: string;
  meetingPoint: string;
  passengerCount: number;
};
