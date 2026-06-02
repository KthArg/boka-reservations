import { createHash } from 'node:crypto';

/** Hash determinístico del token de acceso a la reserva. Mismo algoritmo que
 * la emisión en el worker (spec 0011). Vive sin `server-only` para poder
 * unit-testearlo y reusarlo desde la validación. */
export function hashBookingToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
