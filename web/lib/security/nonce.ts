// Genera un nonce CSP por request (spec 0024). Edge-safe: usa Web Crypto + btoa,
// sin node:crypto ni Buffer, porque el middleware corre en el edge runtime (mismo
// criterio que el atob/TextDecoder de decodeUserRole en middleware.ts).
// 16 bytes aleatorios → base64. El valor es aleatorio por request; lo único fijo
// es el formato (string base64 no vacío, distinto entre dos requests).

const NONCE_BYTES = 16;

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCharCode(...bytes));
}
