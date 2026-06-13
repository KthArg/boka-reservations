/**
 * Enmascara un email para mostrarlo sin exponer el local completo (spec 0021, P1-1).
 *
 * `juan.perez@gmail.com` -> `j***@gmail.com`. Conserva la primera letra del local y el dominio
 * completo (suficiente para que el turista reconozca a qué correo llegó la confirmación, sin
 * filtrar la dirección completa a quien tenga el UUID de la reserva en la URL).
 *
 * Devuelve cadena vacía si el input no es un email enmascarable (sin `@`, local o dominio
 * vacío), para que el llamador omita el bloque en vez de renderizar un valor crudo.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '';
  const domain = email.slice(at + 1);
  if (!domain) return '';
  return `${email[0]}***@${domain}`;
}
