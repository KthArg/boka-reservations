export type EmailLocale = 'es' | 'en';

// Mirror del CHECK de notifications.kind en DB. El worker es self-contained
// (no importa @shared en runtime); este union es su fuente de verdad.
export type NotificationKind =
  | 'booking_confirmation'
  | 'reminder_24h'
  | 'guide_assignment'
  | 'cancellation_confirmation'
  | 'refund_confirmation'
  | 'overbooked_refunded';

export const GUIDE_ASSIGNMENT_KIND: NotificationKind = 'guide_assignment';
export const CANCELLATION_CONFIRMATION_KIND: NotificationKind = 'cancellation_confirmation';
export const REFUND_CONFIRMATION_KIND: NotificationKind = 'refund_confirmation';
export const OVERBOOKED_REFUNDED_KIND: NotificationKind = 'overbooked_refunded';

/** Email ya renderizado, listo para entregar. */
export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

/** Resultado de preparar un email: listo para enviar, o motivo de cancelación. */
export type PreparedEmail = { ok: true; email: RenderedEmail } | { ok: false; reason: string };

export type EmailSendInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type EmailSendResult = {
  providerMessageId: string;
};

export type EmailAdapter = {
  provider: 'resend' | 'mailpit';
  send(input: EmailSendInput): Promise<EmailSendResult>;
};

export class EmailTransientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'EmailTransientError';
  }
}

export class EmailPermanentError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'EmailPermanentError';
  }
}
