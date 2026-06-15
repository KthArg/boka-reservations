import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ONVOPAY_SECRET_KEY: z.string().min(1),
  ONVOPAY_WEBHOOK_SECRET: z.string().min(1),
  NEXT_PUBLIC_ONVOPAY_PUBLIC_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  APP_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  // Kill-switch del rate limiting (spec 0017). Permite desactivarlo rápido en prod si un
  // umbral mal calibrado bloqueara usuarios legítimos, sin redeploy de lógica.
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
  // Secreto dedicado para firmar el token de invitación (spec 0023, ACCESS-04). Antes se
  // reutilizaba SUPABASE_SERVICE_ROLE_KEY; un secreto propio desacopla la clave más sensible.
  INVITE_SIGNING_SECRET: z.string().min(1),
  // Rollout de la CSP con nonces (spec 0024). 'true' emite la política como
  // Content-Security-Policy-Report-Only (observa violaciones sin romper); default 'false'
  // = enforcing. El middleware lo lee directo de process.env (corre en edge), no por acá;
  // este campo documenta y valida la variable del lado Node.
  CSP_REPORT_ONLY: z.enum(['true', 'false']).default('false'),
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
