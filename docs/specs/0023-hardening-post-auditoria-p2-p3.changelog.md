# Changelog — 0023 Hardening post-auditoría (P2/P3)

Registro vivo de la implementación. Lo más reciente arriba.

## 2026-06-14 — Tanda B (P3) implementada (todos los checks verdes)

- **APPSEC-01** (`admin-filters.ts`): regex estricta `^\d{4}-\d{2}-\d{2}$` en `validateExportRange`
  (`Date.parse` aceptaba `2026-01-01"` → rompía el header `Content-Disposition`). +test.
- **APPSEC-02** (`checkout-action.ts`): `customer_name` con cota `max(120)` (`NameSchema`). +test.
- **APPSEC-03** — **DIFERIDO**: `postcss@8.4.31` está pineado por `next@15.5.18` (transitiva
  directa); el override `>=8.5.10` no lo mueve sin re-resolver y arriesga el build. CVE
  moderate **no alcanzable en runtime** (la app no procesa CSS de usuario; vite ya usa 8.5.15).
  Se cierra al subir Next. Se revirtió el override para no dejar el lockfile a medias.
- **PRIV-04** (`sentry.client.config.ts` + `instrumentation.ts`): `sendDefaultPii:false` +
  `beforeSend` que recorta PII de usuario (client y server/edge).
- **PRIV-06** (`checkout-action.ts`): `console.error` ya no vuelca el objeto `err` completo.
- **PRIV-07** (`resend.ts`): `redactErrorBody` redacta emails + acota a 300 chars antes de
  propagar a `notifications.last_error`. +test.
- **PAYSEC-01** (`webhooks/onvopay/route.ts`): guard `payload.status === 'succeeded'` además del
  `eventType`. +test de regresión (status `failed` → 200 sin confirmar).
- **PAYSEC-03** — revisado: no hay log de éxito con el payment-intent id; solo logs de error
  donde el id es necesario para debugging. Retención de logs = ítem de INFRA/dashboard. Sin cambio.
- **INFRA-03**: `import 'server-only'` en `supabase-service`, `supabase-server`, `payments/index`,
  `payments/adapters/onvopay`, `invite-set-token`. Requirió un **stub de `server-only`** aliaseado
  en ambos configs de vitest (`server-only` no es resolvable en el runtime de vitest).
- **INFRA-04** (`client-ip.ts`): `getClientIp(headers)` prefiere `x-vercel-forwarded-for` /
  `x-real-ip` y cae a `x-forwarded-for`. Callers (forgot-password, login, checkout) + test
  actualizados a la nueva firma.
- **INFRA-05** — **DIFERIDO al edge**: `checkAvailability` solo lo usa el checkout (ya
  rate-limited); el browsing público es SSR con RLS + `max_rows`, sin entry point limpio para un
  rate-limit de app sin dañar UX. Se cubre con Vercel Firewall (ítem de cutover).
- **ACCESS-03** (`checkout-action.ts` + `checkout/cancel/page.tsx`): cookie HttpOnly
  `hold_session` con el `session_token` del hold; la cancelación libera el hold **solo si la
  cookie coincide** (no por el UUID crudo). TTL de 15 min como red de respaldo.

**Revisión:** payment-flow-auditor → **APTO** (PAYSEC-01 estrictamente defensivo, no rompe el
camino feliz ni la validación de monto/idempotencia; PRIV-07 no altera la clasificación
transient/permanent).

**Checks:** typecheck OK · lint 0 err · `db reset` 35 migraciones · web 151 unit + 178
integration · worker 72 unit + 18 integration. (Nota: la integración web emite ruido
`ERR_IPC_CHANNEL_CLOSED` en el teardown de vitest en Windows; los 178 tests pasan.)

## 2026-06-14 — Tanda A (P2) implementada (todos los checks verdes)

**ACCESS-02 — rol en el middleware** (`web/middleware.ts`): además de autenticar, exige
`user_role ∈ ADMIN_PANEL_ROLES` en las rutas protegidas, decodificando el claim del JWT
(edge-safe: `atob` + `TextDecoder`, falla cerrado). Defensa en profundidad sobre el layout +
RLS. **Verificado en vivo** (Playwright): admin loguea y llega al dashboard.

**ACCESS-04 — secreto dedicado del invite** (`invite-set-token.ts`, `env.ts`): el token de
invitación se firma con `INVITE_SIGNING_SECRET`, no con el service role key. Agregado a
`env.ts` (validación al boot), `.env.example` y `.env.local`. Unit test actualizado + caso
"firmado con otro secreto no valida".

**INFRA-02 — password policy** (`supabase/config.toml`): `minimum_password_length` 6→8 +
`password_requirements="lower_upper_letters_digits"`. Se aplica a prod con `supabase config push`.

**PRIV-05 — auditoría del export** (`bookings/export/route.ts`): registra `audit_logs`
`booking.export` (actor, rango, conteo; sin PII) best-effort antes de servir el CSV. El guard
se endureció a `!user?.userRole`.

**Sobreventa** (migración `20260614000035`): `confirm_booking` detecta sobrecupo
(`capacity_reserved + p_total_seats > capacity_total`), **confirma igual** (nunca rechaza un
pago hecho) y registra `audit_logs` `booking.overbooked`. Firma `RETURNS void` sin cambios
(`database.ts` intacto). El webhook (`route.ts`) y la reconciliación re-leen la capacidad
post-confirm y emiten un Sentry warning (`fingerprint ['booking-overbooked']`). Revisado por
**db-schema-guardian (APTO)** + **payment-flow-auditor (APROBADO)**.

**Tests:** unit `invite-set-token` (web); integración `overbook.test.ts` (borde exacto: `==`
no marca, `>` sí, idempotencia) + `export-audit.test.ts` (PRIV-05); worker unit de reconcile
actualizado (`fetchInstanceCapacity`). Checks: typecheck OK · lint 0 err · `db reset` 35
migraciones · web 148 unit + 178 integration · worker 69 unit + 18 integration.
`rpc-execute-grants` y `webhook-idempotency` siguen verdes (sin regresión en grants ni
idempotencia tras reescribir `confirm_booking`).

**Decisión sobreventa:** este guard **detecta + confirma + alerta**, NO previene. La
prevención real ("evitarla a todo costo") —auto-refund de la reserva sobrante o rediseño de la
ventana hold/pago— es un follow-up dedicado fuera de 0023.

**Entrega:** dos PRs. Esta es la **Tanda A (P2)**; la **Tanda B (P3)** va en un PR aparte.

**Nota de infra recuperada en el camino:** el spec 0022 (retención/anonimización) había
quedado varado en `fix/0021` por orden de merge de PRs apilados y nunca llegó a `dev`. Se
recuperó con el PR #42 (`feat/0022 → dev`) antes de arrancar 0023, así que 0023 nace de un
`dev` que ya incluye 0022.
