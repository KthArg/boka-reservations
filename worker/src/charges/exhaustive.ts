/**
 * Cierre de un switch exhaustivo: si aparece una acción nueva sin su caso, no compila; si igual
 * llega un valor inesperado en runtime, falla ruidoso en vez de quedar como no-op silencioso.
 */
export function unreachable(value: never): never {
  throw new Error(`caso no contemplado: ${String(value)}`);
}
