// Tipos y errores del segundo factor (spec 0049). Sin server-only: el formulario los importa.
// Los valores son claves de `auth.mfa-errors` en los diccionarios.

export const MfaError = {
  InvalidCode: 'invalid-code',
  TooManyAttempts: 'too-many-attempts',
  SessionExpired: 'session-expired',
  HasFactor: 'has-factor',
  Generic: 'generic',
} as const;

/** Estado de un factor ya verificado en Supabase Auth. */
export const FACTOR_VERIFIED = 'verified';

export type MfaErrorValue = (typeof MfaError)[keyof typeof MfaError];

export type MfaEnrollment =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: MfaErrorValue };

export type MfaVerifyState = { error: MfaErrorValue } | null;
