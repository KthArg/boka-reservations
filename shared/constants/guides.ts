/** Días de validez del token de acceso del guía (magic link, spec 0009). */
export const GUIDE_TOKEN_TTL_DAYS = 30;

/** Segmento de URL de la vista pública del guía: /guia/<token>/proximos-tours */
export const GUIDE_ROUTE_SEGMENT = 'guia';
export const GUIDE_UPCOMING_SEGMENT = 'proximos-tours';

/** Motivos por los que la asignación de un guía puede rechazarse. */
export enum GuideAssignmentError {
  Unauthorized = 'guide_assignment_unauthorized',
  InstanceNotFound = 'guide_assignment_instance_not_found',
  NotAGuide = 'guide_assignment_not_a_guide',
}
