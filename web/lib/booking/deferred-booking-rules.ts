import { BookingStatus } from '@shared/constants/enums';

// Reglas de estado de las páginas del cobro diferido (spec 0029 §5.7, §5.9), puras y compartidas:
// la página de la reserva decide con ellas qué enlaces muestra, y las páginas de tarjeta y de 3DS
// qué entregan. Una sola definición evita que el enlace lleve a "no disponible".

const isFuture = (iso: string | null, now: Date): boolean =>
  iso !== null && new Date(iso).getTime() > now.getTime();

/** Sin cobrar y con el plazo de recuperación vigente (sin plazo todavía: antes del primer rechazo). */
export function isCardUpdateOpen(
  status: string,
  recoveryDeadline: string | null,
  now: Date,
): boolean {
  return (
    status === BookingStatus.PendingMinimum &&
    (recoveryDeadline === null || isFuture(recoveryDeadline, now))
  );
}

/** Cobro en vuelo esperando la autenticación 3DS del turista, con el plazo vigente. */
export function isAwaitingAuthentication(
  status: string,
  awaitingActionUntil: string | null,
  now: Date,
): boolean {
  return status === BookingStatus.PendingPayment && isFuture(awaitingActionUntil, now);
}
