/**
 * Guard del seteo de contraseña (spec 0010, fix de seguridad).
 *
 * El enlace de invitación/recovery lleva el `uid` del usuario para el que se
 * generó (lo agrega /auth/confirm tras verifyOtp). Si la sesión activa del
 * navegador NO es ese usuario —p. ej. un admin seguía logueado en el mismo
 * navegador cuando abrió el enlace de otro usuario— NO se debe cambiar la
 * contraseña de la sesión activa. Devuelve true si hay que rechazar el cambio.
 *
 * Cuando no viene `uid` (flujo viejo de forgot-password, mismo usuario que
 * inició el reset) no se aplica el guard: comportamiento sin cambios.
 */
export function isSessionMismatch(
  expectedUid: FormDataEntryValue | null,
  sessionUserId: string | undefined,
): boolean {
  if (typeof expectedUid !== 'string' || expectedUid.length === 0) return false;
  return sessionUserId !== expectedUid;
}
