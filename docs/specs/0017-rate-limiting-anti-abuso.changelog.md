# Changelog — 0017 Rate limiting y protección anti-abuso

Spec: [0017-rate-limiting-anti-abuso.md](./0017-rate-limiting-anti-abuso.md)
Rama: feat/0017-rate-limiting-anti-abuso

## 2026-06-11 — Implementación completa, verificada por pentest + Playwright, lista para PR

**Hecho**:

- **Decisiones de aprobación** (§13 del spec): store en **Postgres (Opción A, sin vendor
  nuevo)**, umbrales iniciales en constantes, forgot-password vía route handler propio
  antes del PKCE, **fail-open + alerta** ante caída del store, webhook de OnvoPay sin
  límite. Ninguna decisión disparó el bloqueante de `external-services-vetting`.
- **DB**: migración `20260611000027_rate_limits.sql` — tabla `rate_limits(key PK,
window_start, count)` + función `check_rate_limit(text,int,int)` que hace el
  chequeo+incremento **atómico** en una sola sentencia (`INSERT ... ON CONFLICT DO
UPDATE`, el row lock serializa reset-vs-incremento). `SECURITY DEFINER` +
  `SET search_path=''` + `REVOKE EXECUTE FROM PUBLIC` + RLS sin políticas. Tipos del RPC
  y la tabla agregados a mano a `web/types/database.ts`.
- **Constantes**: `shared/constants/rate-limit.ts` (límites/ventanas por endpoint,
  prefijos de clave, `UNKNOWN_IP`). Kill-switch `RATE_LIMIT_ENABLED` en `web/lib/env.ts`
  (+ `.env.example`).
- **Helpers** (`web/lib/security/`): `checkRateLimit` (kill-switch, fail-open + alerta
  Sentry, log de excedidos), `getClientIp` (primer elemento de `x-forwarded-for`),
  `rateLimitKey`/`hashIdentifier` (SHA-256 normalizado — no guarda PII en claro).
- **Aplicación de límites**: login (por IP + email, mismo error genérico al exceder),
  checkout (por IP antes de crear el hold), forgot-password (route handler
  `POST /api/rate-limit/forgot-password` llamado por el form antes del PKCE; en 429 el
  form no llama a Supabase y muestra la misma respuesta neutra).
- **Worker**: job `cleanup-rate-limits` (al arranque + cada hora) que purga filas con
  ventana vencida hace >24h.
- **Tests**: unit de `getClientIp` (incl. spoofing), `rateLimitKey` y `checkRateLimit`
  (kill-switch/fail-open/mapeo, store mockeado); integración de la función SQL contra DB
  real (conteo, reset por ventana, **atomicidad con 12 llamadas concurrentes**) y del
  helper contra el shape real del RPC; integración del job de limpieza. Suite total:
  web unit 137, web integ 121, worker unit 64, worker integ 16. Lint 0 errores, typecheck
  limpio, `db reset` con 27 migraciones OK.

**Por qué / decisiones**:

- **Postgres y no Redis**: cierra el hallazgo sin sumar un procesador de datos ni disparar
  el vetting formal (regla inviolable del proyecto). El round-trip extra es aceptable en
  endpoints sensibles de baja frecuencia (login/checkout/forgot), no en el camino de toda
  request.
- **Fail-open**: con Postgres como store, si está caído login/checkout ya no funcionan por
  otras razones; bloquear sólo agregaría un modo de falla. El fallo se alerta en Sentry.
- **Contar TODOS los intentos de login** (no sólo los fallidos): más simple y seguro; el
  chequeo corre antes de `signInWithPassword`, así una ráfaga de fuerza bruta se frena aun
  si acierta la contraseña dentro de la ventana.
- **Hash de identidad en la clave**: las claves del store son `<prefijo>:<sha256>`,
  verificado que no aparece email/IP en claro.
- **Limitación conocida (documentada en §8 del spec y en el código)**: en local sin proxy
  `x-forwarded-for` es spoofeable, así que el límite **por IP** es evadible rotando el
  header; en producción Vercel reescribe ese header y el primer elemento no es
  spoofeable. El límite **por email** (login/forgot) NO es evadible rotando IP — se
  verificó en el pentest.

**Verificación (pentest + Playwright sobre el build de dev)**:

- **Pentest del route handler de forgot-password** (curl): email bombing se corta en 3;
  rotar la IP NO evade el límite por email; variar mayúsculas/espacios del email NO da
  bucket nuevo (normalización); límite por IP se corta en 10; **ráfaga de 20 requests
  concurrentes → exactamente 3 pasaron** (atomicidad bajo carga real); claves en el store
  hasheadas (sin PII). La evasión por XFF rotado quedó confirmada como limitación local
  esperada y mitigada por Vercel en prod.
- **Pentest del login** (Playwright, navegador real): 5 intentos con contraseña incorrecta
  → error genérico; el 6º con la contraseña **correcta** quedó bloqueado con el mismo error
  (el contador llegó a 6 = el guard corrió antes de `signInWithPassword`). Tras resetear el
  store, el login con credenciales correctas vuelve a funcionar (la ventana libera).
- **Regresión funcional** (Playwright): login exitoso → dashboard; `/dashboard/departures`
  y `/dashboard/bookings` cargan; forgot-password muestra el mensaje neutro; **checkout
  completo** (portal → tour → reserva → "Pagar ahora") crea booking $70 + payment + hold y
  **renderiza el widget de OnvoPay** sin ser bloqueado por el guard. 0 errores de consola.

**Pendiente**:

- Nada — feature lista para PR.

**Notas para retomar**:

- La **Opción C (Vercel Firewall)** como capa de borde por IP queda como tarea de cutover
  (configuración en el dashboard, fuera del repo); anotar en el pre-production-checklist.
- Afinar umbrales observando los eventos "rate limit excedido" en Sentry cuando haya
  tráfico real; los valores actuales son conservadores y viven en
  `shared/constants/rate-limit.ts`.
- El pentest local creó una instancia/booking de prueba que se limpiaron al cerrar; la
  tabla `rate_limits` quedó vacía.
