# 0023 — Hardening post-auditoría (P2 y P3)

- **Estado**: approved
- **Autor**: kenneth
- **Creado**: 2026-06-14
- **Última actualización**: 2026-06-14 (aprobado por spec-reviewer; decisiones de §13 resueltas, 2 bloqueantes incorporados)
- **Rama**: feat/0023-hardening-post-auditoria
- **PR**: #<número> (cuando aplique)

## 1. Contexto y motivación

La re-auditoría del Security Council (`docs/security-audits/2026-06-13-reauditoria-1.md`) y el pentest activo (`docs/security-audits/2026-06-14-pentest-activo.md`) dejaron una cola de hallazgos **no bloqueantes** de severidad media (P2) y baja (P3). Ninguno es explotable hoy —el pentest lo confirmó— pero son deuda de seguridad/calidad que conviene cerrar antes de escalar volumen. El spec 0022 ya cerró dos P2 (PRIV-02 anonimización, PRIV-03 retención). Este spec agrupa el resto de lo **solucionable en código/config versionada**, en dos tandas: primero los P2, luego los P3.

Quedan **fuera** los hallazgos que no se resuelven en código (verificaciones de dashboard de prod), los aceptados por decisión de diseño, los que dependen de un tercero, y los de esfuerzo grande que merecen su propio spec (ver sección 3).

El actor beneficiado es el **operador** (responsable del sistema) y, transitivamente, el **turista** (menos superficie de abuso).

## 2. Objetivos

- Cerrar los 5 hallazgos P2 restantes que son solucionables en código/config.
- Cerrar los hallazgos P3 de higiene de seguridad solucionables, sin tocar lo aceptado por diseño ni lo de esfuerzo mayor.
- No introducir regresiones: cada cambio mantiene el comportamiento existente salvo el endurecimiento puntual, validado por tests.
- Mantener la auditoría de regresión existente verde (`secdef_functions_public_executable`, suites de integración).

## 3. Fuera de alcance

- **ACCESS-01 (residuo)** — la página de éxito enmascara el email pero sigue accesible por UUID crudo. Aceptado por decisión de diseño (spec 0021 §5: enmascarar en vez de tokenizar). No se reabre acá.
- **PAYSEC-02** — usar un id de entrega único como clave de idempotencia depende de que OnvoPay lo exponga (hoy no lo hace). Solo se **documenta la suposición** en el código; no es solucionable sin el proveedor.
- **CSP `'unsafe-inline'` → nonces** — endurecer la CSP con nonces/strict-dynamic en Next 15/React 19 es un trabajo grande con riesgo de romper la hidratación. Va en su propio spec futuro.
- **Verificaciones de dashboard de PROD** (P1-2 signup, RLS a nivel proyecto, Storage, pooling, Vercel/Railway/Resend, llaves `onvo_live_`) — no son código; viven en `GUIA-VERIFICACION-MANUAL.md` y se cierran en el cutover.
- **Anonimización/retención (PRIV-02/03)** — ya resueltas en el spec 0022.
- No se rediseña ningún flujo (checkout, pagos, refunds, auth); son cambios acotados.

## 4. Historias de usuario

> Como operador del sistema, quiero que la superficie de abuso residual quede cerrada (defensa en profundidad, trazabilidad de accesos a PII, robustez del flujo de dinero), para reducir el riesgo operativo sin esperar a un incidente.

Criterios de aceptación (P2):

- [ ] El middleware rechaza (redirect) una sesión autenticada **sin rol de panel** antes de llegar a las rutas `(admin)`, además de la barrera del layout.
- [ ] El token de invitación se firma con un secreto **dedicado** (`INVITE_SIGNING_SECRET`), no con el service role key.
- [ ] La política de contraseñas en `config.toml` exige **≥8 caracteres con complejidad**.
- [ ] El export CSV de reservas (PII masiva) deja un registro en `audit_logs` (actor, rango, conteo).
- [ ] `confirm_booking` detecta cuando confirmar superaría `capacity_total` y, **sin rechazar el pago**, lo registra/alerta para que el operador gestione el sobrecupo.

Criterios de aceptación (P3):

- [ ] Validación estricta de fecha (`^\d{4}-\d{2}-\d{2}$`) en el export de reservas; `customer_name` con cota de longitud; dependencia `postcss` sin el CVE.
- [ ] Sentry con `sendDefaultPii:false` explícito + `beforeSend` que recorta PII; `console.error` del checkout sin volcar el objeto de error; `notifications.last_error` sin el email en claro.
- [ ] El webhook valida `payload.status==='succeeded'`; los logs server-side no incluyen el payment-intent id innecesariamente.
- [ ] `import 'server-only'` en los módulos con secretos; `client-ip` considera `x-vercel-forwarded-for`; la búsqueda pública tiene un rate-limit holgado.

## 5. Diseño técnico

### Tanda A — P2

- **ACCESS-02 · Rol en el middleware** (`web/middleware.ts`). Hoy solo verifica sesión. Se agrega: si la ruta pertenece al grupo `(admin)` (`/dashboard`) y el JWT no trae un `user_role` en `ADMIN_PANEL_ROLES`, redirige a `/login`. Es defensa en profundidad: el choke-point real sigue siendo `(admin)/layout.tsx` + RLS, pero el middleware falla antes. El rol se lee del claim del JWT ya disponible en el middleware (mismo decode que `decodeUserRole`).
- **ACCESS-04 · Secreto dedicado del invite** (`web/lib/auth/invite-set-token.ts`). Se reemplaza el uso de `SUPABASE_SERVICE_ROLE_KEY` como clave HMAC por una env nueva `INVITE_SIGNING_SECRET` (validada en `web/lib/env.ts`, server-only). Mantiene HMAC-SHA256 + `timingSafeEqual` + expiración. Desacopla el secreto más sensible del firmado de invites.
- **INFRA-02 · Password policy** (`supabase/config.toml`). `minimum_password_length` de 6 → **8**; `password_requirements = "lower_upper_letters_digits"`. Versionado; se aplica a prod con `supabase config push`. La app ya exige ≥8 en `reset-password`; esto alinea el servidor.
- **PRIV-05 · Auditoría del export de PII** (`web/app/[locale]/(admin)/dashboard/bookings/export/route.ts`). Tras autorizar (`requireAnyRole`), antes de devolver el CSV, inserta en `audit_logs` un evento `booking.export` con `actor_type` (derivado del rol), `actor_id`, `entity_type='export'`, `entity_id=gen_random_uuid()`, `metadata={ from, to, count }` (sin PII). Se hace con el service client (append-only, solo service_role escribe). **Nota de implementación**: el route ya tiene la referencia `user` (de `requireAnyRole`, que devuelve `AuthUser` con `id`/`userRole`); hoy se usa solo como guard truthy, así que basta con leer `user.id`/`user.userRole` para el actor (no hace falta refactor).
- **Sobreventa · guard de capacidad en `confirm_booking`** (migración nueva). Si un hold vence (15 min) antes de que llegue el webhook, otro hold puede tomar el cupo y ambas reservas confirmar, superando `capacity_total`. Fix: en `confirm_booking`, antes de incrementar `capacity_reserved`, comparar `capacity_reserved + p_total_seats > capacity_total`. **Nunca se rechaza un pago ya hecho** (el turista pagó): la reserva se confirma igual, pero se registra `audit_logs` `booking.overbooked` (con `capacity_total` y el cupo resultante) para que el operador lo gestione (reubicar, abrir cupo, etc.). Se preserva **todo** el cuerpo vigente de `confirm_booking` (idempotencia in-tx, guard `is_public_request`, notificaciones, hold→converted) y **su firma `Returns void` no cambia** → `web/types/database.ts` no se toca. **Mecanismo de alerta (decidido)**: el audit dentro de la función + los callers (webhook `route.ts` y reconciliación) re-leen `tour_instances.capacity_reserved/capacity_total` **después** del confirm y emiten un **Sentry warning** si hay sobrecupo (lectura barata, sin cambiar la firma). Migración `supabase/migrations/20260614000035_confirm_booking_overbook_guard.sql`. Por tocar una money function, requiere `payment-flow-auditor` + `db-schema-guardian`.

  > **Detección, no prevención (alcance de 0023).** Este guard **detecta + confirma (honra el pago) + alerta**; NO _impide_ el sobrecupo. Impedirlo de verdad (objetivo "evitar a todo costo" del usuario) requiere un cambio mayor —p. ej. reembolso automático de la reserva sobrante, o rediseñar la ventana hold/pago (TTL del hold alineado al webhook, o reservar cupo al holdear)— que se trata como **follow-up dedicado** fuera de 0023. La detección+alerta de acá es el primer paso: hace visible y accionable cada sobrecupo mientras se diseña la prevención.

### Tanda B — P3

- **APPSEC-01 · Fecha estricta en export** (`web/lib/booking/admin-filters.ts`): regex `^\d{4}-\d{2}-\d{2}$` antes de `Date.parse` (replica el rigor del export de reports), para que valores como `2026-01-01"` no lleguen al header `Content-Disposition`.
- **APPSEC-02 · Cota de `customer_name`** (`web/lib/booking/checkout-action.ts`): `z.string().trim().min(1).max(120)` en la action pública (espejo de `BookingCreateSchema`). Solo capa de aplicación, sin migración.
- **APPSEC-03 · CVE de `postcss`** (deps de `web`): override de pnpm `postcss>=8.5.10` (o bump de Next si corresponde). No alcanzable en runtime, pero limpia `pnpm audit`.
- **PRIV-04 · Sentry** (`web/sentry.client.config.ts` **y** el init server/edge dentro de `web/instrumentation.ts`): `sendDefaultPii: false` explícito + `beforeSend` que recorta email/nombre de eventos, aplicado en **todas** las inicializaciones (client y server/edge), no solo el client. (En este setup el init server/edge vive en `instrumentation.ts`; no hay `sentry.server.config.ts` separado que crear.)
- **PRIV-06 · log de error del checkout** (`web/lib/booking/checkout-action.ts`): loguear solo el `msg`, no el objeto `err` completo.
- **PRIV-07 · email en `notifications.last_error`** (`worker/src/notifications/repository.ts`, adapter `resend.ts`): truncar/recortar el email del cuerpo de error antes de persistirlo (guardar status + código, no el cuerpo crudo de Resend).
- **PAYSEC-01 · `payload.status` en webhook** (`web/app/api/webhooks/onvopay/route.ts`): guard `if (payload.status !== 'succeeded') return received` además del `eventType`.
- **PAYSEC-03 · payment-intent id en logs** (`route.ts`): no loguear el id salvo en el `console.error` de error real; reducir su presencia en logs de éxito.
- **INFRA-03 · `server-only`** en `supabase-service.ts`, `supabase-server.ts`, `payments/index.ts`, `payments/adapters/onvopay.ts`, `invite-set-token.ts`: agregar `import 'server-only';` (falla en build-time si se importaran en cliente).
- **INFRA-04 · `client-ip`** (`web/lib/security/client-ip.ts`): preferir `x-vercel-forwarded-for`/`x-real-ip` detrás de Vercel, con fallback al primer `x-forwarded-for`. **Implica cambiar la firma de `getClientIp`** (hoy recibe solo el string `forwardedFor`, `client-ip.ts:15`) para tomar varios headers (o el objeto `Headers`), y actualizar el único caller relevante (`checkout-action.ts:23`).
- **INFRA-05 · rate-limit de búsqueda pública**: límite holgado por IP en el **punto de entrada HTTP** de la búsqueda/disponibilidad (la página/route o server action del portal, donde están los headers/IP), **no** en las funciones de datos de `web/lib/booking/availability.ts` (que corren con service client y no ven la request). Reutiliza `checkRateLimit` con umbral generoso (solo anti-scraping). Verificar primero cuál es ese punto de entrada real del portal público.
- **ACCESS-03 · liberar hold por id crudo** (`web/app/[locale]/(public)/checkout/cancel/page.tsx`): hoy libera el hold solo con `?booking=<uuid>`. **Fix (cookie HttpOnly)**: durante el checkout, la server action setea el `session_token` del hold (que ya genera `checkout-action.ts:81`, hoy no expuesto al cliente) en una cookie **HttpOnly + SameSite=Lax + Secure(prod)** (`hold_session`); la página/acción de cancelación condiciona la liberación a que la cookie **coincida** con el `session_token` del hold de esa reserva (no-op si falta o no coincide). Mantiene el TTL de 15 min como red de respaldo. Cambios: setear la cookie en `checkout-action.ts`/`create.ts` tras crear el hold, y leerla + comparar en `checkout/cancel`.

### Decisiones de diseño

- **Sobreventa = confirmar + alertar, nunca rechazar**: rechazar un pago ya capturado deja al turista pagado sin reserva (peor UX y problema de dinero). Se honra el pago y se sube la señal al operador. (Decisión a confirmar — ver §13.)
- **Dos tandas/PRs** (P2, luego P3): cada una cohesiva y reviewable; la Tanda A incluye la migración del money-function (requiere `payment-flow-auditor` + `db-schema-guardian`), la Tanda B es higiene de bajo riesgo.

## 6. Modelo de datos

- **Tabla**: ninguna nueva. Sin columnas nuevas.
- **Función**: `confirm_booking` se reescribe (CREATE OR REPLACE) agregando el guard de capacidad + el audit `booking.overbooked`, preservando el resto del cuerpo vigente (migración `…029`). **La firma no cambia** (mismos args, `Returns void`). Migración `supabase/migrations/20260614000035_confirm_booking_overbook_guard.sql`, con su `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`.
- **APPSEC-02**: opcionalmente un `CHECK (length(customer_name) <= 200)` en DB; se prefiere validación en la action para evitar migración. (Decisión menor; default: solo app.)
- `audit_logs` no cambia de esquema; se le agregan dos `action` nuevos (`booking.export`, `booking.overbooked`) que son solo valores de texto.

## 7. Estados y transiciones

No aplica. El sobrecupo NO introduce un estado de `bookings` nuevo (la reserva queda `confirmed`); solo se registra en `audit_logs`. No se modifican las máquinas de estado existentes.

## 8. Casos borde y errores

- **Sobreventa detectada**: la reserva se confirma (no se pierde el pago), `capacity_reserved` refleja la realidad aunque supere `capacity_total` (no se capea, para no falsear el conteo), y queda el audit + alerta. El operador decide.
- **Middleware sin `user_role`**: un `authenticated` sin claim de rol (no debería existir con el hook activo) → redirect a `/login` (deny-by-default).
- **Rotación de `INVITE_SIGNING_SECRET`**: los invites emitidos antes de rotar el secreto dejan de validar (comportamiento aceptable; los invites son de corta vida). Documentar en el rollout.
- **Export con fecha inválida**: la regex estricta rechaza con error de validación antes de tocar el header (hoy podía colar comillas).
- **ACCESS-03 sin cookie de sesión de hold**: si no hay session token (p. ej. link viejo), la liberación es no-op; el hold expira por TTL igual.
- **Búsqueda pública sobre el límite**: respuesta de rate-limit neutra; no afecta reservas en curso (el checkout tiene su propio límite).
- **`server-only` en un módulo importado por error desde cliente**: el build falla (es el objetivo).

## 9. Impacto en otras áreas

- **Auth/panel**: el guard de rol en middleware no cambia el flujo normal (admin/staff entran igual); solo cierra el borde.
- **Checkout (ACCESS-03)**: la server action setea una cookie HttpOnly `hold_session` (SameSite=Lax, Secure en prod) con el `session_token` del hold; la página de cancelación la lee. Sin impacto en el flujo de pago.
- **Pagos**: el guard de sobreventa toca `confirm_booking` (money function) → requiere revisión de `payment-flow-auditor` + `db-schema-guardian`. El webhook gana el guard de `status`.
- **Worker**: PRIV-07 toca el manejo de error de notificaciones; sin cambio de comportamiento de envío.
- **Variables de entorno**: nueva `INVITE_SIGNING_SECRET` (web, server-only) en `.env.example` + `web/lib/env.ts`. Sin otras envs.
- **Config**: `supabase/config.toml` (password policy) — se aplica con `config push` en el cutover.
- **i18n**: sin textos nuevos relevantes (el mensaje de export inválido reusa el error genérico).
- **Reportes/métricas**: sin cambios (los nuevos `audit_logs` son trazabilidad, no reportes).

## 10. Plan de tests

Según `testing-practices`:

- **Integración (sobreventa)**: tres casos del borde de la comparación `>`: (a) confirmar **justo hasta** `capacity_total` (`reserved + seats == total`) → `confirmed`, **NO** genera `booking.overbooked`; (b) el primer asiento que **excede** (`reserved + seats > total`) → `confirmed`, `capacity_reserved` supera el total y SÍ existe `audit_logs` `booking.overbooked`; (c) idempotencia intacta (reconfirmar el mismo evento no duplica capacity ni audit).
- **Integración (grants)**: `confirm_booking` sigue revocada para anon/authenticated; `secdef_functions_public_executable()` sigue vacío.
- **Integración (PRIV-05)**: el export con sesión admin escribe un `audit_logs` `booking.export` con el conteo; el CSV no cambia de contenido.
- **Integración (middleware ACCESS-02)**: request a `/dashboard` con cookie de sesión sin rol → redirect a login; admin/staff → pasa. (Reusa el patrón de tests de auth.)
- **Unit (APPSEC-01)**: `validateExportRange` rechaza `2026-01-01"` y acepta `2026-01-01`.
- **Unit (APPSEC-02)**: la action rechaza `name` > 120; acepta normales.
- **Unit (ACCESS-04)**: firma/verificación del invite con `INVITE_SIGNING_SECRET`; token con secreto distinto no valida.
- **Unit (PAYSEC-01)**: webhook con `status!=='succeeded'` no confirma (return received).
- **Unit (PRIV-07)**: el `last_error` persistido no contiene el email de entrada.
- **Manual**: `pnpm audit --prod` limpio tras el override de postcss; headers/CSP sin cambios.

## 11. Plan de rollout

- **Dos PRs secuenciales**, ambos contra `dev` (o stacked si 0022 aún no mergeó):
  - **PR 1 (Tanda A — P2)**: middleware, invite secret, password policy, export audit, migración del overbook guard. Requiere `payment-flow-auditor` + `db-schema-guardian` por la migración.
  - **PR 2 (Tanda B — P3)**: el resto (higiene de bajo riesgo).
- **Migración**: `20260614000035_confirm_booking_overbook_guard.sql` (CREATE OR REPLACE de `confirm_booking`; aditiva en comportamiento, forward-only). `db reset` debe pasar la cadena completa.
- **Env nueva**: `INVITE_SIGNING_SECRET` — documentar en `.env.example`; **generar y cargar en Vercel antes del deploy**. Como `web/lib/env.ts` valida al import, una env faltante rompe el **boot global** (no solo el flujo de invites), así que hay que agregarla también a `.env.local` y a los envs de test/CI para no romper la suite. Ítem de cutover.
- **Config**: `config push` aplica la password policy nueva a prod.
- **Tipos**: la firma de `confirm_booking` no cambia (mismos args, `Returns void`), así que `web/types/database.ts` **no se toca**. (Si el diseño cambiara a devolver un flag de overbook —ver §13— habría que editar `database.ts` a mano, NO con `db:types`, y ajustar los tipos de ambos callers.)
- **Reversibilidad**: por revert de cada PR. La migración es forward-only (el cuerpo nuevo es superconjunto del viejo).

## 12. Métricas de éxito

- `pnpm audit --prod` sin vulnerabilidades en `web` y `worker`.
- Suites verdes tras `db reset`; `secdef_functions_public_executable()` y `audit_public_executable_functions()` siguen vacías.
- Un export de reservas deja rastro en `audit_logs`; un intento de confirmar sobre cupo genera `booking.overbooked`.
- El re-pentest de los vectores tocados (middleware sin rol, export, webhook status) confirma el endurecimiento.

## 13. Preguntas abiertas

Las decisiones de diseño quedaron resueltas (2026-06-14):

- **Sobreventa**: se confirma siempre el pago + audit `booking.overbooked` dentro de `confirm_booking` + alerta Sentry por re-lectura en los callers (sin cambiar la firma). Va en la **Tanda A**.
- **Prevención de sobreventa (follow-up, fuera de 0023)**: el usuario priorizó "evitarla a todo costo"; impedirla de verdad (auto-refund de la reserva sobrante o rediseño de la ventana hold/pago) excede este spec y se trata en uno **dedicado** posterior. 0023 deja la detección+alerta como primer paso accionable.
- **ACCESS-03**: se implementa el fix con cookie HttpOnly del `session_token` del hold (Tanda B).
- **Entrega**: dos PRs — Tanda A (P2) primero, Tanda B (P3) después.

Sin preguntas abiertas que bloqueen la implementación.
