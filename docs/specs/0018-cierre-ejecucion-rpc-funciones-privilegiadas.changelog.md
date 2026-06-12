# Changelog — 0018 Cierre de ejecución de RPC de funciones privilegiadas

Spec: [0018-cierre-ejecucion-rpc-funciones-privilegiadas.md](./0018-cierre-ejecucion-rpc-funciones-privilegiadas.md)
Rama: fix/quick-revoca-execute-funciones-anon
PR: #36 (squash `8198598`)

## 2026-06-11 — Hotfix de seguridad de la 2da auditoría, mergeado a `dev`

**Contexto**: hallazgo CRÍTICO del pentest activo de la 2da auditoría. Invocando las RPC
como `anon` (anon key, pública) directo contra PostgREST, todas las funciones
`SECURITY DEFINER` resultaron ejecutables por `anon`/`authenticated` — solo
`custom_access_token_hook` estaba bien cerrada. Causa raíz: en Supabase, los roles
`anon`/`authenticated` reciben `GRANT EXECUTE` por los default privileges del esquema
`public`, y `REVOKE EXECUTE … FROM PUBLIC` (lo único que hacían las migraciones) no toca
esos grants. Impacto: bypass de pago (`confirm_booking`), refund de monto arbitrario
(`cancel_booking`, `p_refund_amount_cents` no capeado + bypass de la política de 24h),
DoS de cupo (`create_hold_atomic`), lockout dirigido (`check_rate_limit`), tampering de
estado (`settle_refund`/`flag_payment_mismatch`/`cancel_stale_pending_booking`).

**Hecho**:

- **Capa 1 (control primario) — migración `20260611000028_revoke_execute_funciones_anon.sql`**:
  `REVOKE EXECUTE … FROM anon, authenticated` en las 7 funciones `SECURITY DEFINER` que
  mutan estado; `FROM anon` en las `report_*` (SECURITY INVOKER; el panel las usa con
  sesión `authenticated`, que conserva su grant). Además fija `SET search_path = ''` en
  `create_hold_atomic` (única `SECURITY DEFINER` que no lo tenía; el hardening del 0011 la
  salteó). No rompe la app: todas se invocan con el **service client** (web y worker).
- **Capa 2 (defensa en profundidad) — migración `20260611000029_guard_identidad_funciones_dinero.sql`**:
  helper `public.is_public_request()` que lee el rol de la request del GUC
  `request.jwt.claims` (verificado en vivo: `anon`→`"anon"`, secret→`"service_role"`,
  usuario→`"authenticated"`; sobrevive dentro de `SECURITY DEFINER`, donde `current_user`
  es el owner). Guard `IF public.is_public_request() THEN RAISE 'FORBIDDEN_PUBLIC_ROLE'`
  al inicio de `confirm_booking`, `cancel_booking`, `settle_refund`, `flag_payment_mismatch`.
  Además `public.secdef_functions_public_executable()` (service-role-only): lista las
  funciones `SECURITY DEFINER` de `public` ejecutables por rol público (base de la
  regresión no enumerativa, que cubre funciones futuras).
- **Tests** (`web/tests/integration/rpc-execute-grants.test.ts`, 28 casos): `anon` y
  `authenticated` → `42501` en las funciones de estado; `service_role` ejecuta; `report_*`
  anon-denegado/authenticated-permitido; y el check no enumerativo que exige **0**
  funciones `SECURITY DEFINER` ejecutables por rol público.

**Validación**:

- `supabase db reset` → 29 migraciones aplican limpio.
- Pentest en vivo: las RPC privilegiadas dan `401 permission denied` como anon; con
  EXECUTE re-otorgado a la fuerza, `confirm_booking` aborta con `FORBIDDEN_PUBLIC_ROLE`;
  `service_role` ejecuta normal; reads públicos siguen `200`.
- Suite: web unit 137, web integ **149**, worker unit 64, worker integ 16; typecheck
  limpio, lint 0 errores.

**Pendiente (cutover)**: desplegar ambas migraciones a la DB de producción apenas exista
prod — la vulnerabilidad es explotable mientras la anon key pública apunte a una DB sin el
fix. Anotado en `pre-production-checklist`.

**Spec retrospectivo**: escrito después del código (hotfix), revisado por `spec-reviewer`.
