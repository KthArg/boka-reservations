import nodemailer from 'nodemailer';
import type { EmailAdapter, EmailSendInput, EmailSendResult } from '../types.js';
import { EmailTransientError } from '../types.js';

// Timeouts defensivos (spec 0028): espejo del adapter de Resend; una conexión SMTP
// colgada no debe bloquear el ciclo del job.
const SMTP_TIMEOUT_MS = 15_000;

export function createMailpitAdapter(host: string, port: number, from: string): EmailAdapter {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });

  return {
    provider: 'mailpit',
    async send(input: EmailSendInput): Promise<EmailSendResult> {
      try {
        const info = await transporter.sendMail({
          from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
          headers: { 'X-Notification-Id': input.idempotencyKey },
        });
        return { providerMessageId: info.messageId };
      } catch (err) {
        throw new EmailTransientError(`mailpit smtp failed: ${(err as Error).message}`);
      }
    },
  };
}
