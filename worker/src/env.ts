import { z } from 'zod';

const envSchema = z
  .object({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    ONVOPAY_SECRET_KEY: z.string().min(1).optional(),
    // Base del API de OnvoPay (spec 0028, A6). Default: producción; sandbox:
    // https://api.dev.onvopay.com/v1 con llaves onvo_test_*.
    ONVOPAY_API_BASE_URL: z.string().url().default('https://api.onvopay.com/v1'),
    APP_URL: z.string().url(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SENTRY_DSN: z.string().url().optional(),

    EMAIL_PROVIDER: z.enum(['mailpit', 'resend']).default('mailpit'),
    EMAIL_FROM: z.string().min(1).default('Boka Verde <no-reply@localhost>'),
    RESEND_API_KEY: z.string().min(1).optional(),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    NOTIFICATIONS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    RETENTION_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // Cobro diferido (specs 0029 y 0033). Default false, igual que en la web: se encienden y se
    // apagan juntos. Con la web encendida y el worker apagado, las reservas nunca se cobran.
    DEFERRED_CHARGE_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Modo de reversión del spec 0033: suelta las autorizaciones vivas y cierra los ciclos
    // abiertos, sin cobrar. Corre aunque el cobro diferido esté apagado.
    RELEASE_AUTHORIZATIONS_ONLY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((v, ctx) => {
    if (v.EMAIL_PROVIDER === 'resend' && !v.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY es obligatorio cuando EMAIL_PROVIDER=resend',
      });
    }
    // Combos de producción (spec 0028, A6): el proceso muere al arrancar en vez de
    // degradar en silencio (refunds acumulándose en pending / emails contra localhost).
    if (v.NODE_ENV === 'production') {
      if (!v.ONVOPAY_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ONVOPAY_SECRET_KEY'],
          message:
            'ONVOPAY_SECRET_KEY es obligatorio en producción (sin él, refunds y reconciliación se estancan en silencio)',
        });
      }
      if (v.EMAIL_PROVIDER !== 'resend') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_PROVIDER'],
          message: 'EMAIL_PROVIDER debe ser resend en producción (mailpit es solo local)',
        });
      }
    }
  });

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Variables de entorno inválidas o faltantes: ${missing}`);
  }
  return result.data;
}

export const env = parseEnv();
