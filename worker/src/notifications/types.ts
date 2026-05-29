export type EmailLocale = 'es' | 'en';

export type NotificationKind = 'booking_confirmation' | 'reminder_24h';

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
