import type { EmailAdapter, EmailSendInput, EmailSendResult } from '../types.js';
import { EmailPermanentError, EmailTransientError } from '../types.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;
const HTTP_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
// PRIV-07 (spec 0023): el cuerpo de error de Resend puede ecoar el email del destinatario.
// Se redactan los emails y se acota la longitud antes de propagarlo a notifications.last_error.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAX_ERROR_BODY = 300;
export function redactErrorBody(s: string): string {
  return s.replace(EMAIL_RE, '[email]').slice(0, MAX_ERROR_BODY);
}

export function createResendAdapter(apiKey: string, from: string): EmailAdapter {
  return {
    provider: 'resend',
    async send(input: EmailSendInput): Promise<EmailSendResult> {
      let res: Response;
      try {
        res = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': input.idempotencyKey,
          },
          body: JSON.stringify({
            from,
            to: input.to,
            subject: input.subject,
            html: input.html,
            text: input.text,
          }),
        });
      } catch (err) {
        throw new EmailTransientError(`fetch failed: ${(err as Error).message}`);
      }

      if (res.status >= HTTP_OK_MIN && res.status < HTTP_OK_MAX) {
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        return { providerMessageId: body.id ?? '' };
      }

      const bodyText = redactErrorBody(await res.text().catch(() => ''));
      if (HTTP_RETRYABLE_STATUSES.has(res.status)) {
        throw new EmailTransientError(`resend ${res.status}: ${bodyText}`, res.status);
      }
      throw new EmailPermanentError(`resend ${res.status}: ${bodyText}`, res.status);
    },
  };
}
