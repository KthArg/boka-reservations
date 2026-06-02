import { UserRole } from './enums';

/** Roles que el admin puede asignar al crear un usuario interno (spec 0010). */
export const MANAGEABLE_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.Staff,
  UserRole.Guide,
];

/** Roles cuyo alta crea cuenta de auth + email de invitación (vs. guía, solo public.users). */
export const LOGIN_ROLES: readonly UserRole[] = [UserRole.Admin, UserRole.Staff];

/** Motivos por los que una acción de gestión de usuarios puede rechazarse. */
export enum UserManagementError {
  Unauthorized = 'user_mgmt_unauthorized',
  NotFound = 'user_mgmt_not_found',
  ValidationFailed = 'user_mgmt_validation_failed',
  EmailTaken = 'user_mgmt_email_taken',
  WriteFailed = 'user_mgmt_write_failed',
  InviteFailed = 'user_mgmt_invite_failed',
  SelfDeactivation = 'user_mgmt_self_deactivation',
  LastAdmin = 'user_mgmt_last_admin',
}
