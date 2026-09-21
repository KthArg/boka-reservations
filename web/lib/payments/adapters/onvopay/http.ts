import { ONVOPAY_API_BASE_URL_DEFAULT } from '@shared/constants/payments';

// Transporte HTTP del adapter de OnvoPay (spec 0029 §5.10: el adapter se partió por recurso al
// sumar los métodos del cobro diferido). Solo lo importa el propio adapter.

// Base URL parametrizable (spec 0028, A6): permite apuntar al sandbox sin editar código. La
// inyecta getPaymentProvider desde la env TIPADA; default: producción.
export const ONVOPAY_API_BASE_DEFAULT = ONVOPAY_API_BASE_URL_DEFAULT;
// Timeout defensivo (spec 0020, L-1): una conexión colgada de OnvoPay ataría la función
// serverless hasta el timeout de plataforma. Espejo de los clientes del worker (15 s).
const HTTP_TIMEOUT_MS = 15_000;

export const HTTP_BAD_REQUEST = 400;
export const HTTP_NOT_FOUND = 404;

export type OnvopayHttp = (method: string, path: string, body?: unknown) => Promise<Response>;

export function createOnvopayHttp(secretKey: string, baseUrl: string): OnvopayHttp {
  return (method, path, body) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secretKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
}

/**
 * Segmento de ruta para un id que puede venir del navegador (spec 0029 §5.2): escapado, un valor
 * con `/`, `..` o `?` no puede cambiar el recurso de un request firmado con la secret key.
 */
export function pathId(id: string): string {
  return encodeURIComponent(id);
}

/**
 * Lanza ante un código no exitoso. Sin el cuerpo de la respuesta: OnvoPay puede reflejar el
 * nombre y el email enviados, y el mensaje termina en logs (PRIV-06, spec 0023).
 */
export function ensureOk(res: Response, operation: string): void {
  if (!res.ok) throw new Error(`OnvoPay ${operation} error ${res.status}`);
}

/** Lee el JSON de una respuesta exitosa; cualquier otro código lanza. */
export async function readJson<T>(res: Response, operation: string): Promise<T> {
  ensureOk(res, operation);
  return (await res.json()) as T;
}
