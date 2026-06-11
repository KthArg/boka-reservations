# Changelog — 0016 Hardening de seguridad web

Spec: [0016-hardening-seguridad-web.md](./0016-hardening-seguridad-web.md)
Rama: feat/0016-hardening-seguridad-web

Decisiones de aprobación (2026-06-11): **1 PR con los 7 hallazgos** (commits por
hallazgo); **CSP directo a enforcing** tras validar en build de prod local. B-4 verificado
(política `admin OR propia fila OR role='guide'` es segura y completa).

## 2026-06-11 — Implementación

**Hecho (M-1, M-4, B-1, B-2, B-3, B-4)**:

- **M-1 (open redirect)**: helper `web/lib/auth/safe-redirect.ts` (`safeRedirectPath`) que
  acepta solo rutas locales (un único `/`, rechaza `//host`, `/\host`, absolutas,
  esquemas). El login (`(auth)/login/actions.ts`) lo usa en el `redirect()` final. El
  `redirectTo` válido ya trae el locale (lo arma el middleware), así que se usa tal cual.
- **M-4 (CSV formula injection)**: `escapeCsvField` (`web/lib/format/csv.ts`) prefija con
  `'` los campos que empiezan con `= + - @` tab o CR antes de entrecomillar. Punto central
  → cubre reservas (`bookingsToCsv`) y reportes. Comentario que prohíbe quitarlo.
- **B-1 (webhook)**: `verifyWebhook` (`adapters/onvopay.ts`) compara el secreto con
  `timingSafeEqual` (chequeo de longitud previo) y valida el body con Zod
  (`OnvopayWebhookBodySchema`) envolviendo el `JSON.parse` → nunca lanza, y campos
  faltantes/no numéricos → `null` (no se propaga `undefined` a la validación del 0014).
- **B-2 (cookie)**: `invite_set` (`auth/confirm/route.ts`) ahora lleva
  `secure: NODE_ENV === 'production'` (sigue HttpOnly + SameSite=Lax). Es la única cookie
  propia seteada a mano (las de sesión las maneja `@supabase/ssr`).
- **B-3 (email)**: `checkout-action.ts` valida `customer_email` con `z.string().email()`
  antes de crear nada (error genérico si es inválido).
- **B-4 (RLS users)**: migración `20260611000026_restrict_users_select.sql` reemplaza
  `users_select_authenticated USING(true)` por
  `USING (user_role='admin' OR id=auth.uid() OR role='guide')` (patrón InitPlan). Verificado
  que cubre todos los reads autenticados sin romper el panel de salidas de staff (ver §13
  del spec). **Pendiente M-2** (headers/CSP) — se hace último para verificar en build de prod.

**Tests** (suite verde): web unit **120** (+15: `safe-redirect.test.ts` 6,
`format/csv.test.ts` 5, B-1 +4 en `onvopay-webhook.test.ts`); integración **117** (+5:
`users-rls.test.ts` — staff ve su fila + guías, NO la PII de otros admin/staff; admin ve
todo). `db reset` reaplica la cadena completa (**26 migraciones**). Typecheck limpio.

**Pendiente**: M-2 (headers de seguridad + CSP) con verificación en `pnpm build && start` +
navegador (checkout/widget bajo la CSP).
