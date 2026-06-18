# Changelog — 0020 Hardening de la 4ta auditoría: signup + PII de guías

Spec: [0020-hardening-4ta-auditoria-signup-pii-guias.md](./0020-hardening-4ta-auditoria-signup-pii-guias.md)
Rama: fix/0020-hardening-signup-pii-guias
PR: (pendiente)

## 2026-06-12 — Implementación (M-1 A/B + L-1)

**Contexto**: hallazgo MEDIA del pentest activo de la 4ta auditoría. La combinación de
(A) auto-registro habilitado en Supabase Auth y (B) la política RLS `users_select_authenticated`
exponiendo toda fila `role='guide'` a cualquier `authenticated`, permitía que un atacante anónimo
se auto-registrara (`POST /auth/v1/signup`) y leyera la PII de los guías (nombre, email, teléfono)
vía PostgREST con la anon key pública. Sin escalada ni fuga de datos financieros/PII de admin-staff
(RLS los oculta), pero sí exposición de datos personales de personal interno.

**Hecho**:

- **M-1(A) — cierre del auto-registro (`supabase/config.toml`)**: `[auth].enable_signup = false`
  (switch global, `GOTRUE_DISABLE_SIGNUP`). No afecta `inviteUserByEmail` (admin API, alta de
  admin/staff) ni recovery/forgot-password ni el seed.
  - **Gotcha del CLI (corrección sobre el spec, verificada en vivo)**: el plan original ponía
    **ambos** toggles (`[auth]` y `[auth.email]`) en `false`. Hacerlo rompió el **login** por
    email (`422 email_provider_disabled` — "Email logins are disabled"): en el CLI 2.101,
    `[auth.email].enable_signup=false` deshabilita el **proveedor de email completo**, no solo el
    signup. Se dejó `[auth.email].enable_signup = true` y se usa **solo** el switch global. Spec
    actualizado (§5) con la corrección. Candidato a entrada de aprendizaje (memory-curator).
- **M-1(B) — RLS de PII de guías (`20260612000032_restrict_guide_pii_to_panel.sql`)**: la política
  `users_select_authenticated` pasa de `… OR role='guide'` a
  `… OR (role='guide' AND (select auth.jwt()->>'user_role') IN ('admin','staff'))`. Conserva los
  3 accesos legítimos (admin ve todo / cada uno su fila / admin-staff ven guías para el panel de
  salidas) y cierra el ilegítimo (un `authenticated` sin rol de panel leyendo PII de guías). La
  vista pública del guía usa `service_role`, no depende de esta política.
- **L-1 — timeout del checkout (`web/lib/payments/adapters/onvopay.ts`)**: `HTTP_TIMEOUT_MS = 15_000`
  - `signal: AbortSignal.timeout(...)` en el `fetch` de `createPaymentSession`, espejo de los
    clientes del worker. Constante local del módulo (decisión documentada en spec §5).
- **Tests**:
  - `web/tests/integration/users-rls.test.ts`: + bloque "authenticated sin rol de panel no ve PII
    de guías" (3 casos, vía `auth.admin.createUser` sin fila en `public.users` → sin claim
    `user_role`); + caso explícito de que staff **sí** ve guías (preservación).
  - `web/tests/integration/signup-disabled.test.ts` (nuevo): `auth.signUp` → rechazado, sin sesión.
  - L-1 cubierto por los tests msw existentes del adapter (sin regresión).

**Validación** (local, tras `supabase stop && start` para recargar config + `supabase db reset`,
32 migraciones):

- Pentest en vivo: `POST /auth/v1/signup` → `422 signup_disabled`; login admin → token con claim
  `user_role=admin`; una sesión `authenticated` sin rol → `users?role=eq.guide` devuelve `[]`.
- Suite: **web unit 139 · web integ 155 · worker unit 64 · worker integ 16**. Typecheck limpio
  (web + worker), lint 0 errores, prettier `--check` limpio.
- Nota de proceso: dos fallos durante la validación fueron ambientales, no del código — (1) el
  toggle `[auth.email]` que rompió el login (corregido), y (2) un leftover `inactive@bokatrails.com`
  de una corrida abortada por un flake de tinypool ("Channel closed"), resuelto con `db reset`.

**Pendiente (cutover)**: deshabilitar el signup en el **Dashboard** del proyecto Supabase de prod
(`config.toml` gobierna local; prod es Dashboard-autoritativo). La migración `…032` se suma al lote
de seguridad a desplegar (`…026/028/029/030/031/032`). Anotado en `pre-production-checklist`.

**Decisiones abiertas del spec**: ambas resueltas por el usuario en la aprobación (no se agrega
auditoría de regresión no-enumerativa para PII; Dashboard autoritativo en prod).
