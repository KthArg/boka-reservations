import { z } from 'zod';

const envSchema = z
  .object({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    ONVOPAY_SECRET_KEY: z.string().min(1).optional(),
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
  })
  .superRefine((v, ctx) => {
    if (v.EMAIL_PROVIDER === 'resend' && !v.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY es obligatorio cuando EMAIL_PROVIDER=resend',
      });
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
