/** Motivos por los que la asignación de un guía puede rechazarse. */
export enum GuideAssignmentError {
  Unauthorized = 'guide_assignment_unauthorized',
  InstanceNotFound = 'guide_assignment_instance_not_found',
  NotAGuide = 'guide_assignment_not_a_guide',
}
