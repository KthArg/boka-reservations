# Auditoría de Seguridad Final — 2026-06-12

> Primera auditoría formal del **Security Council** de `booking-platform`, previa al paso a producción con dinero y datos reales de turistas. El proyecto ya pasó 4 rondas de hardening internas (specs 0016–0020); esta auditoría re-verifica todo el código real desde cero, sin dar nada por seguro por estar documentado.
>
> Coordinador: `security-council-coordinator`. Auditores: `appsec-auditor` (APPSEC), `access-control-auditor` (ACCESS), `payments-security-auditor` (PAYSEC), `data-privacy-auditor` (PRIV), `infra-secrets-auditor` (INFRA). Scope: **todo el sistema, los 5 dominios.**

---

## Veredicto global

### 🟡 GO CON CONDICIONES

No hay hallazgos **P0** (ningún dominio quedó **NO APTO**; ninguna vulnerabilidad crítica explotable). El núcleo de seguridad —pagos, RLS, manejo de secretos, validación de input— está **sólido y muestra un trabajo de hardening serio y correcto**, re-verificado línea por línea. El sistema **puede ir a producción una vez cerradas las 3 condiciones P1** de abajo. Ninguna es una reescritura; son cierres acotados.

**Condiciones a cerrar antes de producción (P1):**

1. **Cerrar el IDOR / exposición de PII en la página pública de éxito de checkout** (`web/app/[locale]/(public)/checkout/success/page.tsx`). Hoy muestra nombre + email de cualquier reserva con solo el UUID en la URL, sin token ni verificación de propiedad. → **P1-1**.
2. **Confirmar en el dashboard de Supabase de PRODUCCIÓN que `enable_signup=false` está efectivamente aplicado.** El flag está en `config.toml` (local); si el proyecto hosted tiene el auto-registro habilitado, se reabre el vector de lectura de PII de guías que cerró el spec 0020. → **P1-2** (verificación de dashboard, no código).
3. **Agregar el punto de consentimiento / aviso de privacidad en el checkout** (checkbox + enlace + persistir la marca de consentimiento). Hoy se recolectan nombre y email sin consentimiento informado, exigido por la Ley 8968. El **mecanismo** lo agrega el sistema; el **texto** y el registro ante PRODHAB son del cliente. → **P1-3**.

Cerradas esas tres, el veredicto pasa a **GO**.

---

## Veredicto por dominio

| Dominio                            | Veredicto            | Bloqueantes (P1)                                                             |
| ---------------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| Seguridad de aplicación (APPSEC)   | 🟡 APTO CON RESERVAS | Ninguno propio (participa en P1-1 por cross-ref). Solo P3.                   |
| Control de acceso (ACCESS)         | 🟡 APTO CON RESERVAS | **P1-1** (ACCESS-01: IDOR / PII en checkout success).                        |
| Seguridad de pagos (PAYSEC)        | 🟢 APTO CON RESERVAS | **Ninguno** — los 7 controles clave ✓. Solo hardening P3.                    |
| Privacidad de datos (PRIV)         | 🟡 APTO CON RESERVAS | **P1-3** (PRIV-01: consentimiento).                                          |
| Infraestructura y secretos (INFRA) | 🟡 APTO CON RESERVAS | **P1-2** (INFRA-01: verificar `enable_signup` en prod). P2: password policy. |

Ningún dominio quedó **NO APTO**. Pagos es el dominio más fuerte (sin reserva bloqueante).

---

## Resumen ejecutivo

El sistema llega a esta auditoría en **buen estado de seguridad**. Las cuatro rondas de hardening previas cumplieron lo que documentan: lo re-verificamos archivo por archivo y migración por migración, y los controles existen y funcionan, no solo en el changelog.

**Lo que está bien (confirmado, no asumido):**

- **Pagos**: precio 100% server-side, webhook con secreto verificado en tiempo constante **antes** de tocar la DB, confirmación solo desde fuentes confiables (webhook verificado o reconciliación server-side, nunca desde el browser), validación de monto/moneda contra la reserva, idempotencia **dentro** de la transacción de `confirm_booking`, refund atómico con single-flight anti-doble-refund, y guards de identidad `service_role` en las 4 funciones de dinero. No se halló vía para pagar menos, obtener servicio sin pagar, robar fondos ni refund fraudulento.
- **Control de acceso**: RLS habilitado en **todas** las tablas sensibles, deny-by-default, funciones `SECURITY DEFINER` con `search_path=''`, doble barrera de identidad (REVOKE de anon/authenticated + guard `is_public_request()`) en funciones de dinero, magic links hasheados con expiración, signup deshabilitado en código.
- **Secretos**: árbol e historial git **limpios** (búsqueda ejecutada de verdad); separación cliente/servidor correcta (ningún secreto sensible con prefijo `NEXT_PUBLIC_`); validación de env con Zod al arranque; headers de seguridad completos (CSP, HSTS preload, frame-ancestors 'none', nosniff, Referrer-Policy, Permissions-Policy); sin CORS permisivo; sin endpoints de debug.
- **Privacidad**: minimización deliberada — el turista solo entrega nombre + email (el teléfono que mencionaba la doc NO se recolecta), a OnvoPay se le envían **cero** datos personales del turista, los datos de tarjeta nunca tocan el sistema, los emails no cruzan PII entre reservas, y la IP se hashea antes de persistir en rate-limit.
- **Código**: sin SQL injection (RPC con parámetros tipados, sin `EXECUTE`/`format()`/concatenación), sin XSS efectivo (escape de HTML en emails, JSX en panel), sin SSRF, sin open redirect (cerrado en spec 0019), CSV formula injection neutralizada.

**Lo más urgente:** un único fallo de **diseño de control de acceso** —la página de éxito de checkout expone PII por UUID en la URL sin token— contradice el patrón de token hasheado que el propio proyecto usa correctamente en `/booking/[token]`. Es el P1 técnico a cerrar. Los otros dos P1 son una verificación de dashboard (signup en prod) y un cierre de cumplimiento (consentimiento). El resto son endurecimientos y mejoras de retención/observabilidad que no bloquean el lanzamiento.

**Recomendación:** cerrar los 3 P1, ejecutar las verificaciones manuales de `GUIA-VERIFICACION-MANUAL.md` (en especial las de dashboards de Supabase/OnvoPay/Resend/Vercel), y salir a producción. Programar los P2 para las primeras semanas y los P3 como mejora continua. Para un sistema con dinero y PII, se recomienda además un pentest externo una vez antes de escalar volumen, usando este reporte como mapa.

---

## Hallazgos consolidados priorizados

### P0 — Críticos (bloquean producción)

**Ninguno.** No se encontraron vulnerabilidades críticas explotables en ningún dominio.

---

### P1 — Altos (resolver antes del lanzamiento)

#### P1-1 · IDOR / exposición de PII en la página de éxito de checkout

- **IDs**: ACCESS-01 (origen) + APPSEC (cross-ref PRIV/ACCESS) + impacto PRIV.
- **Ubicación**: `web/app/[locale]/(public)/checkout/success/page.tsx:16-54`; construcción de la URL en `web/components/public/CheckoutForm/CheckoutForm.tsx:47`.
- **Descripción**: la página de éxito es pública (route group `(public)`, sin sesión) y usa `createSupabaseServiceClient()` (bypassa RLS) para leer una reserva por `searchParams.booking` (UUID crudo), mostrando `customer_name` y `customer_email`. No hay token de acceso ni verificación de propiedad: el único "secreto" es el UUID, que viaja en texto en la URL.
- **Impacto / escenario**: el `booking` queda en historial del navegador, logs de servidor/CDN, headers `Referer` hacia terceros (analytics) y barra de direcciones compartible. Quien obtenga un booking id lee nombre + email del turista visitando la URL. Contradice el patrón correcto ya implementado en `/booking/[token]` (token de 32 bytes hasheado en `booking_access_tokens`).
- **Mitigación**: no pasar el booking id en la URL para mostrar PII. Emitir un token efímero de un solo uso ligado a la sesión de checkout (o reutilizar el `booking_access_token`), o no renderizar PII en esta página y mostrar solo el código corto ya truncado.
- **Esfuerzo**: bajo-medio (1 página + emisión/consumo de token; el patrón ya existe en el repo).
- **Nota de severidad** (ver "Contradicciones resueltas"): no es masivamente explotable (UUIDv4 no enumerable, sin grant DB a anon), por eso es P1 y no P0; pero los vectores de fuga de URL son reales, por eso no es P2.

#### P1-2 · Verificar `enable_signup=false` en el Supabase de producción

- **IDs**: INFRA-01 + ACCESS (verificación manual) + APPSEC (verificación manual).
- **Ubicación**: `supabase/config.toml` (config del CLI **local**) vs proyecto hosted de producción.
- **Descripción**: `config.toml` no aplica automáticamente al proyecto hosted salvo `supabase config push`. El cierre del auto-registro (spec 0020, M-1(A)) es un **setting del servidor**, no solo del repo.
- **Impacto**: si el hosted tiene signup habilitado, cualquiera podría auto-registrarse como `authenticated` y reabrir el vector de lectura de PII de guías que cerró el spec 0020 (toda la cadena de hardening de PII queda neutralizada).
- **Mitigación**: confirmar en el dashboard de Supabase de prod (Authentication → Providers/Settings) que el signup global está deshabilitado. Confirmar también que el hook `custom_access_token_hook` está registrado en prod (si no, el claim `user_role` no se inyecta). Ya listado en `GUIA-VERIFICACION-MANUAL.md` §1.
- **Esfuerzo**: trivial (verificación de dashboard), pero **bloqueante** por su impacto.

#### P1-3 · Punto de consentimiento / aviso de privacidad en el checkout

- **IDs**: PRIV-01.
- **Ubicación**: `web/components/public/CheckoutForm/CheckoutForm.tsx` (sin checkbox de consentimiento; grep de `privacy`/`consent` en todo `web/` sin resultados).
- **Descripción**: el checkout recolecta nombre y email sin consentimiento informado ni enlace a aviso de privacidad / T&C. La Ley 8968 (PRODHAB) exige consentimiento para el tratamiento de datos personales.
- **Mitigación**: **[SISTEMA]** agregar al checkout un checkbox obligatorio con enlace al aviso de privacidad y T&C, y persistir la marca/fecha de consentimiento (p. ej. `bookings.consent_at`) como evidencia. **[CLIENTE]** provee el texto del aviso y hace el registro ante PRODHAB.
- **Esfuerzo**: bajo (sistema). El cumplimiento legal pleno es del cliente; el sistema debe ofrecer el punto.

---

### P2 — Medios (primeras semanas post-lanzamiento)

| ID(s)             | Título                                                                                                     | Ubicación                                                               | Mitigación                                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACCESS-02         | Middleware solo verifica autenticación, no rol                                                             | `web/middleware.ts:8-13,30`                                             | Mitigado por defensa en profundidad (`(admin)/layout.tsx` aplica `requireAnyRole`, RLS, signup off). Agregar verificación de rol en el middleware para fallar antes, o documentar que el choke-point real es el layout.                                                       |
| PRIV-02           | Sin capacidad de borrado/anonimización para derecho de eliminación (Ley 8968)                              | Modelo de datos completo                                                | **[SISTEMA]** proveer operación de anonimización por email (sobrescribir `customer_name`/`customer_email`, conservando montos para contabilidad), ejecutable por admin. Diseño lo facilita (PII concentrada); falta el punto de entrada. Corto plazo: hacerlo por SQL manual. |
| PRIV-03           | Retención indefinida de tokens de acceso vencidos                                                          | `booking_access_tokens`, `guide_access_tokens` (sin job de cleanup)     | Job worker que borre `expires_at < now()` (espejo de `cleanup-rate-limits.ts`). El índice `(booking_id, expires_at)` ya existe.                                                                                                                                               |
| INFRA-02 + ACCESS | Password policy débil (`minimum_password_length=6`, sin complejidad)                                       | `supabase/config.toml:182,185` (dashboard hosted)                       | Subir a ≥8 con complejidad en el dashboard de prod. Aplica a cuentas admin/staff con acceso a panel y PII.                                                                                                                                                                    |
| ACCESS-04 + INFRA | Service role key reutilizada como secreto HMAC del invite token                                            | `web/lib/auth/invite-set-token.ts:7-11`                                 | Usar un secreto dedicado (`INVITE_SIGNING_SECRET`). Funcionalmente seguro hoy (HMAC-SHA256, `timingSafeEqual`, exp), pero acopla la clave más sensible.                                                                                                                       |
| PRIV-05           | Export CSV de reservas (PII masiva) sin registro de auditoría                                              | `web/app/[locale]/(admin)/dashboard/bookings/export/route.ts:13-34`     | Registrar el export en `audit_logs` (actor, rango, conteo). Acceso ya gateado por rol; falta la trazabilidad.                                                                                                                                                                 |
| PAYSEC (xref)     | Riesgo de sobreventa: `confirm_booking` no re-chequea `capacity_total` si un hold venció antes del webhook | `confirm_booking` (`...000024`/`...000029`); `release-expired-holds.ts` | **Correctness/operacional, no fuga de dinero** (cada reserva paga lo correcto). Verificar con el `payment-flow-auditor`/correctness: si dos holds confirman tras expirar uno, puede superarse el cupo. Evaluar re-chequeo de capacidad en la confirmación.                    |

---

### P3 — Hardening (mejora continua)

| ID(s)               | Título                                                                             | Ubicación                                                                                                               | Mitigación                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APPSEC-01           | Validación de fecha laxa rompe header `Content-Disposition` del export de reservas | `web/lib/booking/admin-filters.ts:24`; `.../bookings/export/route.ts:25,31`                                             | Regex estricto `^\d{4}-\d{2}-\d{2}$` antes de `Date.parse` (el export de _reports_ ya es seguro; replicar). Admin-only, sin response-splitting (CR/LF dan NaN). |
| APPSEC-02           | `customer_name` sin cota de longitud                                               | `checkout-action.ts:42`; `...000012_create_bookings.sql:11`                                                             | `z.string().trim().min(1).max(120)` en la action; opcional `CHECK (length <= 200)` en DB.                                                                       |
| APPSEC-03           | `postcss < 8.5.10` (CVE-2026-41305, moderate, transitiva)                          | `web` deps                                                                                                              | No alcanzable en runtime (la app no procesa CSS de usuario). Actualizar Next / override `postcss>=8.5.10`. Worker: `pnpm audit` limpio.                         |
| PRIV-04             | Sentry sin `sendDefaultPii:false` explícito ni `beforeSend` scrubber               | `web/sentry.client.config.ts`, `web/instrumentation.ts`                                                                 | Default ya no envía PII; fijar `sendDefaultPii:false` explícito y `beforeSend` que recorte email/nombre como defensa en profundidad.                            |
| PRIV-06             | `console.error` vuelca el objeto de error completo en checkout                     | `web/lib/booking/checkout-action.ts:79`                                                                                 | Loguear solo `msg` (ya disponible), no el objeto `err`.                                                                                                         |
| PAYSEC-01           | Webhook no valida `payload.status` además del `eventType`                          | `web/lib/payments/adapters/onvopay.ts:68-90`                                                                            | Guard `if (payload.status !== 'succeeded') return received`. No inducible por atacante (requiere firmar webhook).                                               |
| PAYSEC-02           | Clave de idempotencia = id del payment-intent, no id de entrega único              | `onvopay.ts:84`; `route.ts:77`                                                                                          | Robusto hoy (guard de estado + `ON CONFLICT`); si OnvoPay expone id de evento/entrega, usarlo. Documentar la suposición.                                        |
| PAYSEC-03 + INFRA   | Logs server-side incluyen el payment-intent id                                     | `route.ts:29,47`                                                                                                        | No es exposición al cliente; confirmar retención/acceso de logs (INFRA).                                                                                        |
| INFRA-03            | Falta `import 'server-only'` en módulos con secretos                               | `supabase-service.ts`, `supabase-server.ts`, `payments/index.ts`, `payments/adapters/onvopay.ts`, `invite-set-token.ts` | Agregar el guard. Riesgo real bajo (Next solo inlinea `NEXT_PUBLIC_*`); es defensa en build-time.                                                               |
| INFRA-04 + APPSEC   | Confianza en `x-forwarded-for[0]` para rate-limit                                  | `web/lib/security/client-ip.ts`                                                                                         | No-spoofeable solo detrás de Vercel (target confirmado). Aceptable; considerar `x-vercel-forwarded-for` para robustez extra.                                    |
| INFRA-05            | Búsqueda/disponibilidad pública sin rate-limit propio                              | `web/lib/booking/availability.ts`                                                                                       | Reads idempotentes sin efecto en inventario; el checkout sí está limitado. Límite holgado por IP si se observa scraping.                                        |
| INFRA (CSP parcial) | `'unsafe-inline'` en CSP `script-src`/`style-src`                                  | `web/next.config.ts`                                                                                                    | Limitación documentada de hidratación Next 15/React 19. Endurecer a nonces es trabajo futuro. `'unsafe-eval'` ya está correctamente limitado a dev.             |

---

## Contradicciones resueltas

**1. Severidad del IDOR de checkout success (ACCESS vs APPSEC).**

- **ACCESS-01** lo calificó **ALTA** / cerrar antes del go-live.
- **APPSEC** lo señaló como cross-ref, "mitigado en la práctica por UUIDs de alta entropía (no enumerables), impacto limitado".
- **Juicio del coordinador**: es un **Broken Object Level Authorization** real. La entropía del UUIDv4 mitiga la **enumeración masiva**, pero **no** mitiga los vectores que ACCESS identificó: el UUID viaja en texto en la URL y las URLs se filtran (historial, logs de servidor/CDN, `Referer` a analytics de terceros, enlaces compartidos). "El UUID es el secreto" es una defensa débil cuando ese secreto está en la barra de direcciones. **Se resuelve como P1** (resolver antes del lanzamiento): no es P0 porque no es masivamente explotable (sin enumeración trivial, sin grant DB a anon), pero no es P2 porque va a producción con PII real de turistas y el patrón correcto (token hasheado) ya existe en el mismo repo. Prevalece la lectura de ACCESS, acotada por el matiz de explotabilidad de APPSEC.

**2. Cobertura de rate-limiting (INFRA "parcial").**

- No es una contradicción real entre auditores: INFRA marcó "parcial" porque la búsqueda pública no tiene límite propio y el magic link/OTP se apoya en los límites nativos de Supabase Auth. Los flujos con efecto (login, forgot-password, checkout) **sí** están cubiertos a nivel app con store atómico. Se acepta como **P3** (INFRA-05), con la verificación de los límites de Auth en el dashboard delegada a la guía manual.

No hubo otras discrepancias de fondo entre los auditores: las valoraciones coincidieron y los cross-refs fueron consistentes (cada uno remitió correctamente lo que cruzaba a otro dominio).

---

## Matriz de cobertura

| Dominio                    | Estado      | Justificación                                                                                                                                                                                           |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seguridad de aplicación    | 🟡 Amarillo | Sin injection/XSS/SSRF/redirect/deserialización explotables (re-verificado). Reservas menores (validación de fecha, cota de nombre, CVE transitiva no alcanzable) + participación cross-ref en el IDOR. |
| Control de acceso          | 🟡 Amarillo | RLS y grants sólidos y re-verificados migración por migración; matriz de roles correcta. Un IDOR (ACCESS-01) a cerrar y un middleware a endurecer.                                                      |
| Seguridad de pagos         | 🟢 Verde    | Los 7 controles clave ✓ con evidencia. Sin vía de abuso económico. Solo endurecimientos P3 no bloqueantes.                                                                                              |
| Privacidad de datos        | 🟡 Amarillo | Minimización fuerte y sin fuga activa de PII. Faltan consentimiento (P1-3), anonimización (P2) y cleanup de tokens (P2).                                                                                |
| Infraestructura y secretos | 🟡 Amarillo | Sin secretos en árbol ni historial; headers y env-validation completos. Pendientes de dashboard (signup prod, password policy) y guards `server-only`.                                                  |

Leyenda: 🟢 sólido / 🟡 sólido con reservas a cerrar / 🔴 bloqueante abierto. **Ningún dominio en rojo.**

---

## Límites de esta auditoría

El council audita **código y configuración versionada**. **No** verifica lo que depende de dashboards, del sistema corriendo o de un humano atacando en vivo. Antes de producción, ejecutar las verificaciones de **[`GUIA-VERIFICACION-MANUAL.md`](GUIA-VERIFICACION-MANUAL.md)**. Las más críticas tras esta auditoría:

- **Supabase (dashboard)**: confirmar `enable_signup=false` en prod (**P1-2**, bloqueante), registro del hook `custom_access_token_hook`, RLS real por tabla, password policy ≥8 (P2), Storage buckets, connection pooling, cifrado en reposo.
- **Vercel**: env scopeadas por ambiente (preview ≠ secretos de prod), protección de previews, redirect HTTP→HTTPS y certificado, logs sin secretos/PII.
- **Railway (worker)**: env sin filtrarse en logs, sin puertos públicos innecesarios.
- **OnvoPay**: `ONVOPAY_WEBHOOK_SECRET` del dashboard coincide con el desplegado, URL del webhook correcta, llaves `onvo_live_` solo en prod, cuenta KYC activa, comportamiento real de refunds en sandbox.
- **Resend**: dominio verificado, SPF/DKIM/DMARC, API key con permisos mínimos.
- **Con el sistema corriendo**: tampering de montos con tarjeta de prueba, IDOR sobre magic links, rutas admin sin/baja autorización, webhooks falsificados y replay, rate-limiting en vivo, secretos en el bundle, headers en runtime, PII en los 5 emails reales.
- **Pentest profesional externo**: recomendado al menos una vez antes de escalar volumen. Este reporte sirve de mapa para definir el scope.
- **Revisión legal**: Ley 8968 (PRODHAB), obligaciones fiscales/ICT, T&C — responsabilidad del cliente.

---

## Anexos — Reportes detallados por auditor

### Anexo A — appsec-auditor

#### Veredicto del dominio

**APTO CON RESERVAS** — No se hallaron vulnerabilidades de código explotables (sin SQL injection, sin XSS efectivo, sin SSRF, sin command/template injection, sin open redirect, sin deserialización insegura). La validación con Zod, el escape de HTML en emails y la parametrización de queries/RPC son consistentes y correctos. Las reservas son menores: un gap de validación de fecha en un export admin, falta de cota de longitud en `customer_name`, y una dependencia transitiva con CVE moderado. Ninguna bloquea producción; conviene corregirlas igual.

#### Cobertura

Revisado archivo por archivo:

- **Webhook**: `web/app/api/webhooks/onvopay/route.ts` + adapter `web/lib/payments/adapters/onvopay.ts` (verificación de secreto constant-time, Zod en el body).
- **Server actions**: checkout (`checkout-action.ts`, `create.ts`, `checkout-pricing.ts`, `quantities.ts`), cancelación (`cancel-action.ts`, `cancel.ts`), users (`users/actions.ts`, `create.ts`), tours (`tours/actions.ts`, `parse.ts`, `types.ts`), guías (`assign-action.ts`), refunds (`retry-action.ts`), check-in (`checkin-action.ts`), auth (`login/actions.ts`, `reset-password/actions.ts`, `auth/actions.ts`).
- **Rutas**: `auth/callback`, `auth/confirm`, `api/rate-limit/forgot-password`, exports CSV de bookings y reports, páginas `[token]` de booking/guide, `checkout/success`.
- **Emails (XSS almacenado)**: todos los templates en `worker/src/notifications/templates/` + `render.ts`, `format.ts`, `prepare.ts`, `layout.ts`.
- **DB**: `shared/schemas.ts`, las 32 migraciones SQL (funciones RPC, SECURITY DEFINER, grants), filtros PostgREST dinámicos.
- **Redirect/IP/rate-limit**: `safe-redirect.ts`, `client-ip.ts`, `rate-limit.ts`, `invite-set-token.ts`, env (`web/lib/env.ts`, `worker/src/env.ts`).
- **Dependencias**: `pnpm audit --prod` en web y worker.

Fuera de alcance (referido a otros auditores): RLS/grants y la confianza en el claim `user_role` del JWT (ACCESS), exposición de PII en `checkout/success` (PRIV/ACCESS), spoofing de `X-Forwarded-For` fuera de Vercel y `minimum_password_length=6` en config (INFRA).

No verificable solo desde el código: comportamiento real de OnvoPay/Resend en producción; que `enable_signup=false` esté efectivamente recargado en el stack corriendo (depende de `supabase stop && start`).

#### Vulnerabilidades críticas / altas / medias

Ninguna.

#### Vulnerabilidades bajas

- **APPSEC-01 | `web/lib/booking/admin-filters.ts:24` + `web/app/[locale]/(admin)/dashboard/bookings/export/route.ts:25,31` | Validación de fecha laxa permite romper el header `Content-Disposition` del export de reservas.** `validateExportRange` valida `dateFrom`/`dateTo` con `Date.parse()` directo (sin normalizar), que acepta valores como `2026-01-01"` (PoC: `Date.parse('2026-01-01"')` → VALID). Ese valor llega al header `Content-Disposition: attachment; filename="reservas-2026-01-01"_..."`, rompiendo el entrecomillado. **Vector**: admin autenticado pasa `?dateFrom=2026-01-01"` y manipula el nombre/estructura del header de su propia descarga. No hay response-splitting (CR/LF dan NaN y se rechazan; undici/Next bloquean CR/LF en headers). Impacto real limitado (endpoint admin-only). **Mitigación**: regex estricto `^\d{4}-\d{2}-\d{2}$` antes de `Date.parse` (el export de _reports_ en `reports/range.ts` ya es seguro porque concatena `T00:00:00-06:00` antes de parsear — replicar ese rigor).
- **APPSEC-02 | `web/lib/booking/checkout-action.ts:42` + `supabase/migrations/20260527000012_create_bookings.sql:11` | `customer_name` sin cota de longitud.** `checkoutAction` solo valida no-vacío tras `trim()` (sin `max`, a diferencia de `BookingCreateSchema` con `max(120)`), y la columna `customer_name text` no tiene límite. **Vector**: el endpoint público de checkout acepta un `name` de varios MB → se persiste y se inyecta (escapado) en el HTML del email, inflando el payload a Resend. Es higiene de input, no XSS. **Mitigación**: `z.string().trim().min(1).max(120)` en la action (y opcional `CHECK (length(customer_name) <= 200)` en DB).
- **APPSEC-03 | dependencia `postcss < 8.5.10` (CVE-2026-41305, moderate) en `web` | XSS vía `</style>` sin escapar en el stringify de PostCSS.** Transitiva por Next.js. No alcanzable en runtime (la app no procesa CSS de usuario; PostCSS corre en build sobre CSS Modules propios). **Mitigación**: actualizar Next.js / forzar `postcss>=8.5.10` vía override de pnpm. Worker: `pnpm audit` limpio.

#### Requiere verificación manual o pentesting

- Confirmar en el entorno corriendo que `POST /auth/v1/signup` está efectivamente rechazado (el flag `enable_signup=false` solo aplica tras `supabase stop && start`; el test `signup-disabled.test.ts` lo cubre pero requiere el stack reiniciado).
- Pentest del flujo de magic link (booking/guide tokens): verificar que no haya fijación/replay más allá de la expiración y el hash SHA-256 (el código es correcto: token aleatorio de 32 bytes, solo hash en DB, expiración validada).
- Validar en runtime que el WAF/edge de Vercel rechaza headers con CR/LF (defensa adicional a APPSEC-01).
- Confirmar que OnvoPay realmente entrega el secreto del webhook en `X-Webhook-Secret` (diseño de secreto estático, no HMAC por mensaje).

#### Referencias cruzadas

- **PRIV/ACCESS** — `checkout/success/page.tsx:18-22`: lee un `booking` UUID crudo y no autenticado del query string y muestra `customer_name` + `customer_email`. Mitigado en la práctica por UUIDs de alta entropía (no enumerables), pero es IDOR / exposición de PII sin token. (→ P1-1.)
- **ACCESS** — `web/lib/auth/server.ts:14-21`: `decodeUserRole` decodifica el payload del JWT sin verificar firma para extraer `user_role`. Seguro porque `supabase.auth.getUser()` valida el token antes, pero ACCESS debe confirmar la confianza en ese claim (y el hook `custom_access_token_hook`).
- **INFRA** — `client-ip.ts`: rate-limit por IP toma el primer `X-Forwarded-For`; no-spoofeable solo detrás de Vercel.
- **INFRA** — `supabase/config.toml:182`: `minimum_password_length = 6`, más débil que el mínimo de 8 que aplica la app en `reset-password/actions.ts`.

**Notas positivas confirmadas**: SQL injection inexistente (RPC con parámetros tipados; sin `EXECUTE`/`format()`/`||`/`quote_*`); filtros PostgREST `.or()` usan `today` server-generado o input sanitizado (`sanitizeSearch`). XSS en emails mitigado con `escapeHtml`; panel y páginas `[token]` con JSX. CSV formula injection neutralizada (`escapeCsvField`). Open redirect cerrado (`safeRedirectPath`). SSRF inexistente. Concurrencia de holds/rate-limit serializada en SQL (`FOR UPDATE`, `INSERT ON CONFLICT`). SECURITY DEFINER de dinero endurecidas (`search_path=''` + guard de identidad + revoke de anon/authenticated).

---

### Anexo B — access-control-auditor

#### Veredicto del dominio

**APTO CON RESERVAS** — El modelo de autorización es sólido y muestra hardening serio y correcto: RLS habilitado en toda tabla sensible, deny-by-default para `bookings/payments/notifications/refunds/tokens`, funciones SECURITY DEFINER con `search_path=''`, doble barrera de identidad (REVOKE de anon/authenticated + guard `is_public_request()`) en las funciones que mueven dinero, separación correcta guía/panel, magic links hasheados con expiración, y signup deshabilitado. Las cinco migraciones de hardening citadas hacen exactamente lo que dicen (re-verificado línea por línea). **La reserva**: existe un IDOR real en la página pública de éxito de checkout que expone PII de cualquier cliente (nombre + email) usando solo el UUID como "secreto", sin token ni validación de propiedad. No es bloqueante absoluto (UUID v4 no trivialmente enumerable, sin grant DB a anon), pero es un fallo de diseño de control de acceso que debe cerrarse antes del go-live.

#### Cobertura

- **32 migraciones** (`20260523000001` → `20260612000032`): cada `CREATE TABLE`, `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT/REVOKE` y `CREATE FUNCTION` (16 funciones, todas las SECURITY DEFINER).
- **Auth core**: `web/lib/auth/server.ts`, `actions.ts`, `invite-set-token.ts`, `middleware.ts`.
- **Layouts/guards de ruta**: `(admin)/layout.tsx`, `users/page.tsx`, `bookings/[id]/page.tsx`, páginas `guide/[token]`, `booking/[token]`, `checkout/success|cancel`.
- **Server actions por dominio**: users (`actions/create/manage/guards/repository`), guides (`assign-action/guide-view/token`), booking (`cancel-action/cancel/checkout-action/checkin-action/admin-detail/access-token/create`), refunds (`retry-action`), reports (`queries`), reset-password.
- **Tokens de magic link**: `worker/src/notifications/booking-token.ts`, `guide-token.ts`.
- **Clientes Supabase** (server vs service vs public), webhook OnvoPay, `supabase/config.toml`.

#### Matriz de acceso verificada

| Rol     | Recurso/Acción                                             | ¿Permitido?      | ¿Bien restringido? | Evidencia                                                                                     |
| ------- | ---------------------------------------------------------- | ---------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| anon    | tours/pricing/schedules/instances (catálogo activo/futuro) | Sí               | Sí                 | `20260524000010` políticas `*_select_anon` con filtros (`status='active'`, `starts_at>NOW()`) |
| anon    | bookings/payments/users/refunds/tokens (PostgREST)         | No               | Sí                 | RLS sin políticas + `REVOKE SELECT ... FROM anon` (`...000009`); cero `GRANT ... TO anon`     |
| anon    | ejecutar RPC privilegiadas                                 | No               | Sí                 | `...028`/`...029` `REVOKE EXECUTE ... FROM anon, authenticated`; guard `is_public_request()`  |
| anon    | auto-registro (`/auth/v1/signup`)                          | No               | Sí                 | `config.toml` `enable_signup = false` (cierra M-1(A))                                         |
| staff   | leer bookings/payments/notifications/refunds/audit_logs    | Sí               | Sí                 | políticas `*_select_admin_staff` `IN ('admin','staff')`                                       |
| staff   | leer PII de otros admin/staff en `users`                   | No               | Sí                 | `...026` quita `USING(true)`; staff solo ve su fila + guías                                   |
| staff   | leer PII de guías                                          | Sí (panel)       | Sí                 | `...032` condiciona `role='guide'` a lector `IN('admin','staff')`                             |
| staff   | crear/editar/desactivar usuarios                           | No               | Sí                 | `users_insert/update/delete` exigen `user_role='admin'`; actions con `requireRole(Admin)`     |
| staff   | cambiar config crítica de tours/pricing                    | No               | Sí                 | políticas `*_admin` exigen `'admin'`; `tours/actions.ts` `requireRole(Admin)`                 |
| staff   | asignar guías, check-in, cancelar, retry refund            | Sí               | Sí                 | actions con `requireAnyRole(ADMIN_PANEL_ROLES)` antes de service_role                         |
| guide   | ver sus salidas/instancias                                 | Sí (token)       | Sí                 | `getGuideUpcomingTours` valida token y filtra `guide_id=...`                                  |
| guide   | ver PII de turistas                                        | No               | Sí                 | `guide-view` solo devuelve `passengerCount` (agregado)                                        |
| guide   | ver salidas de otros guías                                 | No               | Sí                 | query `tour_instance_guides.eq('guide_id', guideId)` derivado del token                       |
| guide   | cambiar su rol / su `active`                               | No               | Sí                 | sin login; `users_update_self` impide cambio de rol                                           |
| turista | ver/cancelar su reserva                                    | Sí (token)       | Sí                 | `/booking/[token]` resuelve `booking_id` por hash del token                                   |
| turista | ver otra reserva por id crudo                              | **Sí (parcial)** | **No**             | **`checkout/success` expone name+email por `?booking=<uuid>` sin token (ACCESS-01)**          |
| turista | confirmar reserva sin pagar / refund arbitrario vía RPC    | No               | Sí                 | `...028`/`...029` cierran ejecución                                                           |

#### Tablas/endpoints sin RLS o autorización detectados

- **Tablas sin RLS**: ninguna. Todas con `ENABLE ROW LEVEL SECURITY` (verificado: users, tours, tour_pricing, tour_schedules, tour_instances, tour_holds, bookings, payments, processed_webhook_events, notifications, tour_instance_guides, guide_access_tokens, refunds, audit_logs, booking_access_tokens, rate_limits).
- **Endpoint sin control de propiedad**: `checkout/success/page.tsx` y `checkout/cancel/page.tsx` — leen `bookings` por id crudo de query-param con service_role (ACCESS-01 y ACCESS-03).

#### Vulnerabilidades críticas

Ninguna. (El vector histórico — RPC de dinero ejecutables por anon — está cerrado y re-verificado en `...028`/`...029`/`...030`.)

#### Vulnerabilidades altas

- **ACCESS-01 | `checkout/success/page.tsx:16-54` + `CheckoutForm.tsx:47` | IDOR / Broken Object Level Authorization.** Página pública usa `createSupabaseServiceClient()` (bypassa RLS) para leer una reserva por `searchParams.booking` (UUID crudo) y muestra `customer_name` + `customer_email`. Sin token ni verificación de propiedad. **Escenario**: el `booking` queda en historial, logs de servidor/CDN, `Referer` a terceros, URL compartible. Contradice el patrón correcto de `/booking/[token]`. **Mitigación**: token efímero de un solo uso ligado a la sesión (o reutilizar `booking_access_token`), o no renderizar PII. (→ P1-1.)

#### Vulnerabilidades medias

- **ACCESS-02 | `web/middleware.ts:8-13,30` | Autorización por rol ausente en middleware (mitigada por defensa en profundidad).** Solo verifica `!user`, no rol. Un `authenticated` sin `user_role` pasaría el middleware. **No es alta**: `(admin)/layout.tsx` aplica `requireAnyRole(ADMIN_PANEL_ROLES)` como choke-point real, las páginas suman `requireRole(Admin)`, las queries usan cliente RLS, y signup está off. **Mitigación**: agregar verificación de rol en el middleware o documentar que la autorización real vive en layout/RLS.

#### Vulnerabilidades bajas

- **ACCESS-03 | `checkout/cancel/page.tsx:14-29` | Mutación de `tour_holds` por id de reserva crudo.** Libera el hold (`status='released'`) de una reserva `pending_payment` por `?booking=<uuid>` sin token. **Impacto bajo**: el hold expira en 15 min, solo aplica a `pending_payment`, `.eq('status','active')` lo hace inocuo si ya no está activo; no expone datos. **Mitigación**: ligar a token/sesión o aceptar el riesgo dado el TTL.
- **ACCESS-04 | `invite-set-token.ts:7-11` | HMAC del invite usa el service role key como secreto.** Funcionalmente seguro (HMAC-SHA256, `timingSafeEqual`, exp), pero acopla dos secretos. **Mitigación**: secreto dedicado (`INVITE_SIGNING_SECRET`). Cruce con INFRA.

#### Requiere verificación manual

- RLS a nivel proyecto en el dashboard; que no haya políticas/grants creados a mano fuera de migraciones.
- `enable_signup=false` aplicado a producción (setting del servidor, no solo del repo); hook `custom_access_token_hook` registrado en prod o el claim `user_role` no se inyecta.
- Correr `secdef_functions_public_executable()` y `audit_public_executable_functions()` contra prod tras migrar; deben devolver 0 filas.
- Confirmar que ningún endpoint público devuelve listados de booking ids (enumerabilidad de ACCESS-01).

#### Referencias cruzadas

- **PRIV**: ACCESS-01 expone PII (nombre+email); origen control de acceso, impacto privacidad.
- **INFRA**: ACCESS-04 (service role como secreto HMAC); `SUPABASE_SERVICE_ROLE_KEY` solo server-side (verificado: solo en `supabase-service.ts`, server actions, worker).
- **PAYSEC**: integridad de funciones de dinero verificada desde autorización; lógica de montos es de PAYSEC.
- **APPSEC**: robustez de la verificación de `x-webhook-secret`.

---

### Anexo C — payments-security-auditor

#### Veredicto del dominio

**APTO CON RESERVAS** — El flujo de dinero está bien diseñado y defendido en profundidad: precio 100% server-side, webhook con secreto constant-time verificado antes de tocar la DB, confirmación solo desde fuentes confiables, validación de monto/moneda contra la reserva, idempotencia dentro de la transacción de `confirm_booking`, refund atómico con single-flight y guard anti-doble-refund, y guards de identidad `service_role` en las 4 funciones de dinero. No se encontró vía para pagar menos, obtener servicio sin pagar, robar fondos ni provocar refund fraudulento. Las "reservas" son endurecimientos menores (no bloqueantes), no huecos explotables.

#### Cobertura

- `web/lib/payments/`: `index.ts`, `types.ts`, `adapters/onvopay.ts`; `web/app/api/webhooks/onvopay/route.ts`.
- `web/lib/booking/`: `create.ts`, `checkout-action.ts`, `checkout-pricing.ts`, `pricing-math.ts`, `cancel.ts`, `cancel-action.ts`, `admin-detail.ts`; `web/lib/pricing/active-filter.ts`, `web/lib/refunds/retry-action.ts`, `web/lib/format/money.ts`, `shared/constants/policies.ts`.
- `CheckoutForm.tsx`; páginas `checkout/success`, `tours/[id]/checkout`, `booking/[token]`, `booking/[token]/cancel`, `CancelConfirm.tsx`.
- Worker: `refunds/onvopay.ts`, `refunds/repository.ts`, `jobs/process-refunds.ts`, `reconciliation/onvopay.ts`, `reconciliation/repository.ts`, `jobs/reconcile-pending-payments.ts`, `jobs/release-expired-holds.ts`.
- Migraciones: `...012` (bookings/payments/processed_webhook_events/confirm_booking), `...018` (refunds/audit_logs/cancel_booking), `...019_settle_refund_atomic`, `...020_harden_booking_functions`, `...021_audit_logs_append_only`, `...023_cancel_stale_pending_booking`, `...024_webhook_idempotency_in_confirm_booking`, `...025_payment_mismatch`, `...029_guard_identidad_funciones_dinero`, `...011_create_tour_holds`.
- Tests: `onvopay-webhook.test.ts`, `webhook-handler.test.ts`, `webhook-idempotency.test.ts`.

#### Checklist de controles clave

- **[✓] Cálculo de precio server-side, sin confiar en el cliente** — `checkout-action.ts` solo recibe `instance_id`, cantidades, nombre, email; nunca un precio. `initCheckout` (`create.ts:35`) llama `resolveAuthoritativeCharge` que carga `tour_pricing` desde la DB y calcula con `computeAuthoritativeTotal`. El payment intent se crea con `totalAmountCents` recalculado (`create.ts:64-68`).
- **[✓] Verificación del secreto del webhook antes de confirmar, comparación constante en tiempo** — `route.ts:11` llama `verifyWebhook` ANTES de cualquier acceso a DB; si falla → 400. `secretMatches` (`onvopay.ts:35-40`) usa `crypto.timingSafeEqual`. Reserva menor: el early-return por longitud filtra la longitud del secreto (no su contenido); con alta entropía, impacto despreciable.
- **[✓] Confirmación solo desde fuente confiable** — Únicos llamadores de `confirm_booking`: webhook verificado (`route.ts:73`) y `confirmRecoveredBooking` de la reconciliación (`reconciliation/repository.ts:78`), que consulta el estado real a OnvoPay vía GET antes de recuperar. El `onSuccess` del widget solo navega a `/checkout/success` (solo lectura); NO confirma.
- **[✓] Política de cancelación/refund evaluada server-side con hora del servidor** — `computeRefund` (`policies.ts:30`) usa `now: Date` provisto server-side, default `new Date()`. El cliente solo envía el token; monto y elegibilidad se recomputan en el servidor. El monto del refund sale del PAGO exitoso.
- **[✓] Anti-replay / idempotencia del webhook dentro de la transacción** — `confirm_booking` (`...024`/`...029`) inserta `processed_webhook_events(p_event_id)` con `ON CONFLICT DO NOTHING` DENTRO de la transacción, antes del `SELECT ... FOR UPDATE`; un fallo posterior hace rollback de ambos. Guard de estado + `FOR UPDATE` serializan concurrencia. Tests cubren rollback, reentrega secuencial y concurrente.
- **[✓] Refund atómico, sin doble refund ni monto mayor al pagado** — `settle_refund` (`...019`/`...029`) hace refund/payment/booking + notificación + audit en una transacción, idempotente. `process-refunds.ts` reclama la fila (`claimForProcessing`) ANTES de postear a OnvoPay (single-flight). El monto sale de `refund.amount_cents`, que `cancel_booking` tomó de `payments.amount_cents`. Índice único parcial `refunds_one_active_per_booking`.
- **[✓] Integridad booking↔payment** — `payments` tiene `UNIQUE(external_provider, external_payment_id)`. El handler compara `amountCents` y `currency` (normalizada) contra `payment.amount_cents`/`currency`; discrepancia → `flag_payment_mismatch`, NO confirma. La reconciliación aplica la misma validación.

#### Vulnerabilidades críticas / altas / medias

Ninguna.

#### Vulnerabilidades bajas / informativas (no bloqueantes)

- **PAYSEC-01 | `onvopay.ts:68-90` | El webhook no valida `payload.status` además de `eventType`.** Confirma si `eventType === 'payment-intent.succeeded'` y el monto coincide, sin exigir `data.status === 'succeeded'`. Requiere que OnvoPay emita evento `succeeded` con status no exitoso y monto exacto (contradicción del proveedor, no inducible sin el secreto). Riesgo ~nulo. **Mitigación**: guard `if (payload.status !== 'succeeded') return received`.
- **PAYSEC-02 | `onvopay.ts:84` + `route.ts:77` | La clave de idempotencia (`p_event_id`) es el id del payment-intent, no un id de entrega único.** El payload de OnvoPay no trae id de evento; se usa `body.data.id = paymentId`. Como un intent mapea a una sola reserva y solo se procesa `succeeded`, el doble-procesamiento ya lo bloquean el guard de estado y el `ON CONFLICT`. Robusto hoy, frágil si se procesara más de un tipo de evento por intent. **Mitigación**: usar id de entrega si OnvoPay lo expone; documentar la suposición.
- **PAYSEC-03 | `route.ts:29,47` | Logs server-side incluyen el payment-intent id y errores de flag.** No es exposición al cliente ni hay datos de tarjeta. **Mitigación**: confirmar retención/acceso de logs (INFRA); no incluir el id si no es necesario.

#### Requiere verificación manual o pentesting

- Config real del webhook en el dashboard de OnvoPay (secreto coincidente, HTTPS, reintentos). Esquema de secreto compartido (no HMAC) → rotación manual; documentar el procedimiento.
- Comportamiento real de OnvoPay ante refund parcial/duplicado y ausencia de clave de idempotencia en `POST /v1/refunds`: validar en sandbox que un doble POST no genere doble crédito si el single-flight fallara.
- Pentest de `/api/webhooks/onvopay`: fuzzing, replay con secreto válido capturado (depende de TLS), `paymentId` inexistente → 404 sin efectos.
- Verificación de moneda CRC vs USD en producción: el checkout fija `CHECKOUT_CURRENCY = 'USD'` y `tour_pricing.price_usd`; confirmar con OnvoPay que el intent se cobra y reporta en USD.

#### Referencias cruzadas

- **ACCESS / funcional (overbooking, no PAYSEC)**: `confirm_booking` incrementa `capacity_reserved` por `p_total_seats` sin re-chequear `capacity_total`. Si un hold expira (15 min) antes de que llegue el webhook, otro hold puede tomar el cupo y ambas reservas confirmar, superando `capacity_total`. **No es hueco de dinero** (cada reserva paga su monto correcto), pero sí riesgo operativo/de sobreventa. Para correctness/ACCESS. (→ P2.)
- **INFRA-SECRETS**: gestión/rotación de `ONVOPAY_SECRET_KEY` y `ONVOPAY_WEBHOOK_SECRET`; retención de logs con payment-intent ids (PAYSEC-03); que `SUPABASE_SERVICE_ROLE_KEY` (única identidad que pasa el guard `is_public_request`) no se filtre.
- **APPSEC**: `secretMatches` con early-return por longitud; robustez del parsing Zod del webhook (cubierta por tests).

---

### Anexo D — data-privacy-auditor

#### Veredicto del dominio

**APTO CON RESERVAS** — La arquitectura de datos personales es notablemente sólida y muestra minimización deliberada: el turista solo entrega **nombre + email** (el teléfono que mencionaba `decisions.md` NO se recolecta en el código real), a OnvoPay se le envían **cero** datos personales del turista (solo monto, moneda y nombre del tour), los emails nunca cruzan PII entre reservas, los tokens van **hasheados** en DB, el store de rate-limit **hashea IP y email**, y la exposición de PII de guías ya fue cerrada (migración 0032) y re-verificada. Lo que falta para producción es: (a) **[SISTEMA]** punto de consentimiento / aviso de privacidad en el checkout (inexistente — bloqueante blando para Ley 8968), (b) **[SISTEMA]** job de limpieza de tokens vencidos, y (c) **[SISTEMA]** ausencia de capacidad de borrado/anonimización para un derecho de eliminación. Ninguno es fuga activa de datos.

#### Cobertura

- Modelo de datos: las 32 migraciones (bookings, users, payments, refunds, audit_logs, notifications, booking/guide_access_tokens, rate_limits) — columnas, RLS y cascadas.
- Notificaciones/emails: `worker/src/notifications/` completo — `prepare.ts`, `prepare-cancellation.ts`, `render.ts`, `repository.ts`, `guide-repository.ts`, tokens, adapters (Resend), y plantillas.
- Exports/reportes CSV: `web/lib/booking/csv.ts`, `export-repository.ts`, `web/lib/reports/csv.ts`, `queries.ts`, ruta `dashboard/bookings/export/route.ts` con su guard de rol.
- Logging y Sentry: todos los `console.*` en `web/` y `worker/`, `web/lib/audit/log.ts`, `web/sentry.client.config.ts`, `web/instrumentation.ts`.
- PII a terceros: cuerpo del fetch a OnvoPay (`payments/adapters/onvopay.ts`), cuerpo a Resend (`adapters/resend.ts`), almacenamiento Supabase.
- Tokens/PII en URLs: `booking-token.ts`, `guide-token.ts`, `access-token.ts`, `booking/[token]/page.tsx`, headers de `next.config.ts`.
- Consentimiento: `CheckoutForm.tsx` y grep de "privacy/consent" en todo `web/`.

#### Inventario de PII

| Dato                  | Tabla/Campo                                                 | Origen                     | Flujos (destinos)                                                     | Tercero               |
| --------------------- | ----------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------- | --------------------- |
| Nombre del turista    | `bookings.customer_name`                                    | Checkout                   | DB → email → CSV admin → panel                                        | Resend                |
| Email del turista     | `bookings.customer_email` + `notifications.recipient_email` | Checkout                   | DB → email → CSV admin → panel. Indexado                              | Resend                |
| Teléfono del turista  | — **NO se recolecta**                                       | —                          | —                                                                     | —                     |
| Nombre del staff/guía | `users.full_name`                                           | Alta por admin             | DB → panel; nombre del guía → su email de asignación                  | Resend (solo al guía) |
| Email del staff/guía  | `users.email`                                               | Alta por admin             | DB → panel admin; login                                               | Supabase Auth         |
| Teléfono del guía     | `users.phone` (NOT NULL solo guías)                         | Alta por admin             | DB → solo lista de usuarios (admin-only). NO a departures/emails/guía | —                     |
| Datos de tarjeta      | **NO tocan el sistema**                                     | Widget OnvoPay client-side | Browser → OnvoPay directo                                             | OnvoPay               |
| Monto/moneda/tour     | `payments`, OnvoPay intent                                  | Server                     | DB → OnvoPay (sin nombre/email)                                       | OnvoPay               |
| IP del cliente        | `rate_limits.key` **hasheada SHA-256**                      | `x-forwarded-for`          | Hash antes de persistir; purga a 24h                                  | —                     |
| actor_id (staff)      | `audit_logs.actor_id` (uuid)                                | Cancelaciones/refunds      | DB → panel. `metadata` sin nombre/email                               | —                     |
| Token de acceso       | `*_access_tokens.token_hash` (SHA-256)                      | Worker al emitir email     | Plano solo en email/URL; en DB solo hash                              | —                     |

#### Hallazgos críticos

Ninguno. No se detectó fuga activa de PII (ni a logs, ni a Sentry, ni entre reservas, ni a terceros más allá de lo necesario).

#### Hallazgos medios

- **PRIV-01 | `CheckoutForm.tsx` + todo `web/` (grep sin resultados de privacy/consent) | Sin aviso de privacidad ni consentimiento en el checkout.** Recolecta nombre y email sin checkbox ni enlace a aviso/T&C. La Ley 8968 exige consentimiento informado. **Mitigación [SISTEMA]**: checkbox obligatorio con enlace, persistir marca/fecha (`bookings.consent_at`). El **texto** es del **[CLIENTE]**. (→ P1-3.)
- **PRIV-02 | Modelo de datos completo (no existe ruta/función de borrado) | El sistema no ofrece forma de localizar y borrar/anonimizar la PII de una persona.** No hay endpoint/Server Action/función SQL para un derecho de acceso/eliminación. Borrar un `bookings` cascadea bien, pero no hay mecanismo que lo invoque ni anonimización (preferible al borrado físico para conservar integridad contable). **Mitigación [SISTEMA]**: operación de anonimización por email ejecutable por admin. El diseño lo **facilita** (PII concentrada); falta el punto de entrada. La política es del **[CLIENTE]**. (→ P2.)
- **PRIV-03 | `supabase/migrations/` + `worker/src/jobs/` (sin cleanup) | Retención indefinida de tokens de acceso vencidos.** `booking_access_tokens` y `guide_access_tokens` no se purgan (a diferencia de `rate_limits`). Crecen sin techo con credenciales vencidas. **Mitigación [SISTEMA]**: job worker que borre `expires_at < now()`. El índice `(booking_id, expires_at)` ya existe. (→ P2.)

#### Hallazgos bajos

- **PRIV-04 | `web/sentry.client.config.ts:1-7` y `web/instrumentation.ts:3-9` | Sentry sin `sendDefaultPii:false` explícito ni `beforeSend`.** Default ya no envía PII; el webhook solo manda `bookingId` (UUID). **Mitigación [SISTEMA]**: fijar `sendDefaultPii:false` explícito y `beforeSend` que recorte emails/nombres como defensa en profundidad.
- **PRIV-05 | `dashboard/bookings/export/route.ts:13-34` | El export CSV de reservas (nombre + email de todos los turistas del rango) no deja registro de auditoría.** Acceso bien gateado (`requireAnyRole`, cliente RLS), pero descargar PII masiva no escribe en `audit_logs`. **Mitigación [SISTEMA]**: registrar el export (actor, rango, conteo). El CSV de **reportes** es agregado y no lleva PII — correcto. (→ P2.)
- **PRIV-06 | `checkout-action.ts:79` | `console.error` vuelca el objeto de error completo.** En este flujo `err` viene de `initCheckout` (DB/OnvoPay); improbable que embeba PII, pero es riesgo latente. **Mitigación [SISTEMA]**: loguear solo `msg`, no el objeto `err`.

#### Responsabilidad del cliente (no del sistema)

- Redactar y publicar el **aviso de privacidad** y los **T&C** (el sistema muestra el punto de consentimiento — PRIV-01; el texto es del cliente).
- **Registro de la base de datos ante PRODHAB** si aplica.
- Definir formalmente la **política de retención** (el sistema debe poder ejecutarla — PRIV-02/03).
- **Atender los derechos** de acceso/rectificación/eliminación (el sistema facilita la localización/borrado — PRIV-02).
- Acuerdo de **encargado de tratamiento** con los terceros (Resend, Supabase) según PRODHAB.

#### Requiere verificación manual

- **Cifrado en reposo de Supabase**: estándar del proveedor; confirmar en dashboard.
- **Retención de PII en logs de Vercel y Railway**: los `console.*` con IDs y, en el peor caso, el `err` de PRIV-06; URLs con tokens de magic-link en logs de acceso (mitigado por `expires_at`, potenciado si se resuelve PRIV-03).
- **Resend**: dominio verificado + SPF/DKIM/DMARC; API key con permisos mínimos; retención del cuerpo HTML con PII.
- **PII en emails reales**: enviar los 5 tipos y confirmar visualmente que ninguno filtra datos de terceros.

#### Referencias cruzadas

- **ACCESS**: la corrección de la exposición world-readable de PII de guías (migración `20260612000032`) re-verificada (bien condicionada al rol del lector). El IDOR de checkout success (ACCESS-01) expone PII y se eleva a P1.
- **INFRA**: HTTPS forzado y retención de logs de Vercel/Railway. HSTS preload y CSP ya en `next.config.ts`.
- **APPSEC**: el escape HTML de la PII en plantillas (`escapeHtml`) previene inyección — correcto.
- **PAYSEC**: minimización hacia OnvoPay (cero PII del turista en el intent) y manejo client-side de la tarjeta — punto fuerte de privacidad.

---

### Anexo E — infra-secrets-auditor

#### Veredicto del dominio

**APTO CON RESERVAS** — La superficie de infraestructura y el manejo de secretos están sólidos: no hay secretos hardcodeados ni en el historial git, la separación cliente/servidor es correcta (ningún secreto sensible con prefijo `NEXT_PUBLIC_`), la validación de env con Zod corre al arranque, los headers de seguridad están completos, no hay CORS permisivo, no hay endpoints de debug, y el rate limiting cubre los flujos críticos. Las reservas: (1) varios items críticos de config solo se confirman en dashboards (Supabase hosted, Vercel, OnvoPay, Resend) y NO están versionados; (2) `minimum_password_length=6` sin complejidad; (3) falta `import 'server-only'` en módulos sensibles (mitigado por la regla de Next de inlinear solo `NEXT_PUBLIC_*`); (4) `'unsafe-inline'` en CSP `script-src`. Ninguna es bloqueante por sí sola, pero los items de dashboard deben verificarse antes del go-live.

#### Cobertura

`.gitignore`, `web/next.config.ts`, `web/middleware.ts`, `web/lib/env.ts`, `worker/src/env.ts`, `supabase/config.toml`, `.github/workflows/ci.yml`, `package.json` (root), ambos `.env.example`, todo `web/app/api/`, los 4 route handlers (`auth/callback`, `auth/confirm`, dos `export`), `web/lib/security/*`, `web/lib/payments/*`, `web/lib/db/supabase-service.ts`, `web/lib/auth/invite-set-token.ts`, `worker/src/index.ts` y jobs/clientes HTTP. **Búsqueda de secretos en el árbol** (`git grep`) y **en el historial completo** (`git log --all -p`) con patrones `onvo_live_/onvo_test_`, `sk_`, `re_`, JWTs `service_role`, asignaciones de envs sensibles: **resultado limpio** (todos los matches son placeholders de `.env.example`, fixtures de test `onvo_test_integration`, o JWT públicas de demo de Supabase local).

#### Checklist de configuración

| Ítem                                  | Estado             | Evidencia / nota                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secretos fuera del repo               | ✓                  | Tree e historial limpios. `.env`/`.env.local`/`worker/.env` ignorados (`git check-ignore` confirma), nunca commiteados. Solo `*.env.example` con placeholders.                                                                          |
| Separación NEXT_PUBLIC vs server-only | ✓                  | `NEXT_PUBLIC_*` solo en SUPABASE_URL, SUPABASE_ANON_KEY (RLS la protege), ONVOPAY_PUBLIC_KEY (publishable), SENTRY_DSN. Secretos solo en módulos server. `supabase-service.ts` no importado por ningún `'use client'`.                  |
| Validación de env con Zod             | ✓                  | `web/lib/env.ts` y `worker/src/env.ts` con `safeParse` al import; worker usa `superRefine` para condicionar `RESEND_API_KEY`.                                                                                                           |
| CSP                                   | parcial            | Bien construida (`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`). `'unsafe-eval'` solo en dev. `'unsafe-inline'` persiste en `script-src`/`style-src` (limitación de hidratación Next 15/React 19). |
| HSTS                                  | ✓                  | `max-age=63072000; includeSubDomains; preload`.                                                                                                                                                                                         |
| X-Frame-Options / frame-ancestors     | ✓                  | `DENY` + CSP `frame-ancestors 'none'`.                                                                                                                                                                                                  |
| X-Content-Type-Options                | ✓                  | `nosniff`.                                                                                                                                                                                                                              |
| Referrer-Policy                       | ✓                  | `strict-origin-when-cross-origin`.                                                                                                                                                                                                      |
| Permissions-Policy                    | ✓                  | `camera=(), microphone=(), geolocation=(), browsing-topics=()`.                                                                                                                                                                         |
| CORS no permisivo                     | ✓                  | Sin `Access-Control-Allow-Origin`; API same-origin.                                                                                                                                                                                     |
| Rate limiting                         | parcial            | Login (email+IP), forgot-password (email+IP), checkout (IP) a nivel app (store Postgres atómico). Magic link/OTP por límites nativos de Supabase Auth (dashboard). Búsqueda pública sin límite propio (INFRA-05).                       |
| HTTPS forzado                         | requiere dashboard | Redirect y certificado los maneja Vercel; HSTS preparado en código.                                                                                                                                                                     |
| Sin endpoints de debug                | ✓                  | Solo 2 rutas `api/` + 4 route handlers (2 export con `requireAnyRole`→401). Worker sin puerto HTTP. Ninguna expone versión/env/stack.                                                                                                   |

#### Hallazgos críticos

Ninguno. No se encontraron secretos hardcodeados ni en el historial, ni claves sensibles expuestas al cliente.

#### Hallazgos medios

- **INFRA-01 | `supabase/config.toml` (dashboard hosted) | Config de Auth solo verificable en local.** `config.toml` es la config del CLI local; no aplica al hosted salvo `supabase config push`. `enable_signup=false` (spec 0020), `jwt_expiry`, password policy y rate limits de Auth deben confirmarse en el dashboard de prod. **Riesgo**: si el hosted tiene signup habilitado, reabre el vector PII-guías. **Mitigación**: verificar en dashboard. (→ P1-2.)
- **INFRA-02 | `supabase/config.toml:182,185` | Password policy débil.** `minimum_password_length=6` y `password_requirements=""`. Aplica a cuentas admin/staff con acceso a panel/PII. **Mitigación**: ≥8 con `lower_upper_letters_digits` en el dashboard; cruza con ACCESS. (→ P2.)

#### Hallazgos bajos

- **INFRA-03 | `supabase-service.ts`, `supabase-server.ts`, `payments/index.ts`, `payments/adapters/onvopay.ts`, `invite-set-token.ts` | Falta `import 'server-only'`.** Tocan secretos sin el guard (sí lo tienen `users/create.ts`, `users/manage.ts`, `security/rate-limit.ts`). **Riesgo bajo**: Next solo inlinea `NEXT_PUBLIC_*`; el guard agregaría falla en build-time. **Mitigación**: agregar `import 'server-only';`. (→ P3.)
- **INFRA-04 | `web/lib/security/client-ip.ts` | Confianza en `x-forwarded-for[0]`.** No-spoofeable solo detrás de Vercel (documentado en el archivo). Vercel es el target confirmado → aceptable. **Mitigación**: considerar `x-vercel-forwarded-for`/`x-real-ip` para robustez extra. (→ P3.)
- **INFRA-05 | `web/lib/booking/availability.ts` y portal público | Búsqueda/disponibilidad pública sin rate-limit propio.** Reads idempotentes (`max_rows=1000` en PostgREST + RLS); el checkout sí está limitado. **Mitigación**: opcional, límite holgado por IP si hay abuso/scraping. (→ P3.)

#### Requiere acceso a dashboards (no verificable desde el repo)

Cubierto en `GUIA-VERIFICACION-MANUAL.md`; este reporte remite a ella:

- **Supabase (hosted)**: RLS real por tabla; **config de Auth de prod** (`enable_signup=false`, expiración JWT, password policy ≥8 — INFRA-01/02); hook `custom_access_token_hook`; Storage buckets; pooling; API auto-generada; cifrado en reposo.
- **Vercel**: env por ambiente (preview ≠ secretos de prod); protección de previews; **redirect HTTP→HTTPS y certificado**; logs sin secretos/PII.
- **Railway (worker)**: env sin filtrarse en logs; sin puertos públicos innecesarios.
- **OnvoPay**: webhook secret coincidente; URL correcta; llaves `onvo_live_` solo en prod; KYC activa.
- **Resend**: dominio verificado, SPF/DKIM/DMARC, API key con permisos mínimos.

#### Referencias cruzadas

- **PAYSEC**: webhook valida `x-webhook-secret` en tiempo constante (`timingSafeEqual`) e idempotencia vía `confirm_booking`/`processed_webhook_events`. Validación de monto/moneda (spec 0014). Lógica de pagos es de PAYSEC.
- **ACCESS**: rutas de export con `requireAnyRole`→401; middleware redirige sin sesión. Password policy débil (INFRA-02) cruza con ACCESS.
- **PRIV**: `enable_signup=false` cierra el vector de lectura de PII de guías; confirmar en dashboard. Store de rate-limit hashea la identidad (SHA-256).
- **APPSEC**: `requestOrigin` de `auth/confirm/route.ts` confía en `x-forwarded-host` (aceptable detrás de Vercel); robustez de redirect/CSRF es de APPSEC.

---

_Reporte generado por el Security Council de booking-platform. El council audita; las correcciones las decide y ejecuta el usuario. Para todo lo que requiere dashboards, sistema corriendo o pentesting, ver [`GUIA-VERIFICACION-MANUAL.md`](GUIA-VERIFICACION-MANUAL.md)._
