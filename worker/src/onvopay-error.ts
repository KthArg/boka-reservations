// Error HTTP de OnvoPay con el status a mano y el cuerpo saneado (auditoría 2026-10-18, PRIV-10).
// El mensaje termina en console.error (logs de Railway), en Sentry y en columnas como
// failure_reason: el cuerpo crudo puede ecoar datos del cliente, así que se redactan emails y
// secuencias largas de dígitos y se acota la longitud. Espejo de `redactErrorBody` de Resend.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const LONG_DIGITS_RE = /\d{12,}/g;
const MAX_ERROR_BODY = 300;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_REQUEST_TIMEOUT = 408;

export function redactOnvopayBody(s: string): string {
  return s
    .replace(EMAIL_RE, '[email]')
    .replace(LONG_DIGITS_RE, '[digits]')
    .slice(0, MAX_ERROR_BODY);
}

export class OnvopayHttpError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    body: string,
  ) {
    super(`onvopay ${operation} ${status}: ${redactOnvopayBody(body)}`);
    this.name = 'OnvopayHttpError';
  }

  /**
   * El request pudo haberse aplicado igual: un 5xx de OnvoPay o de un proxy, o un 408 (timeout
   * del lado del servidor, que también puede llegar después de procesar).
   */
  get isServerError(): boolean {
    return this.status >= HTTP_SERVER_ERROR_MIN || this.status === HTTP_REQUEST_TIMEOUT;
  }
}

export async function onvopayHttpError(
  operation: string,
  res: Response,
): Promise<OnvopayHttpError> {
  return new OnvopayHttpError(operation, res.status, await res.text().catch(() => ''));
}
