import { createHash } from 'node:crypto';

/** Hash determinístico del token de guía. Mismo algoritmo que la emisión en el worker. */
export function hashGuideToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
