# Changelog — 0023 Hardening post-auditoría (P2/P3)

Registro vivo de la implementación. Lo más reciente arriba.

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
