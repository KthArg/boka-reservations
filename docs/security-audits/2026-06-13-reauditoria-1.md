# Re-Auditoría de Seguridad 1 — 2026-06-13

> **Re-auditoría del Security Council** de `booking-platform`, posterior a la auditoría inicial [`2026-06-12-auditoria-final.md`](2026-06-12-auditoria-final.md) y al cierre de sus condiciones P1 (spec `docs/specs/0021-cierre-p1-auditoria-council.md`, rama `fix/0021-cierre-p1-auditoria-council`).
>
> **Enfoque de re-auditoría** (proceso del coordinador): (a) verificar que las 3 condiciones P1 de la auditoría inicial se cerraron y que el cierre es correcto y completo; (b) detectar regresiones introducidas por los cambios del 0021; (c) barrido normal exhaustivo de los 5 dominios sobre el código real en HEAD. Nada se da por seguro por estar documentado.
>
> Coordinador: `security-council-coordinator`. Auditores: `appsec-auditor` (APPSEC), `access-control-auditor` (ACCESS), `payments-security-auditor` (PAYSEC), `data-privacy-auditor` (PRIV), `infra-secrets-auditor` (INFRA). Scope: **todo el sistema, los 5 dominios.**

---

## Qué cambió desde la auditoría inicial (2026-06-12)

La auditoría inicial emitió **🟡 GO CON CONDICIONES** con 3 condiciones P1 (0 P0). El spec 0021 cerró las dos que son código y dejó documentada la tercera (verificación de dashboard). Estado tras esta re-auditoría:

| Condición P1 inicial                                                     | Naturaleza                  | Estado en esta re-auditoría                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P1-1 · IDOR / PII en `checkout/success`** (ACCESS-01)                  | Código                      | ✅ **CERRADO** — verificado por ACCESS + PRIV + APPSEC. La página dejó de seleccionar `customer_name` y dejó de renderizar el email completo; ahora muestra solo el email **enmascarado** (`j***@dominio`) vía `maskEmail` server-side. Residuo de severidad **baja** (P3), aceptado por decisión de diseño documentada. |
| **P1-3 · Consentimiento / aviso de privacidad** (PRIV-01)                | Código                      | ✅ **CERRADO** — verificado por PRIV + APPSEC. Checkbox `required` con enlaces, **validación server-side** en `checkout-action.ts` antes de rate-limit/hold/booking, persistencia de evidencia (`consent_at` + `consent_version` estampada por el server), páginas `/privacy` y `/terms`.                                |
| **P1-2 · `enable_signup=false` en el Supabase de PRODUCCIÓN** (INFRA-01) | **Dashboard / operacional** | 🟡 **ABIERTO (no resoluble en código)** — el flag y el hook siguen correctos y versionados en `config.toml`, cubiertos por `signup-disabled.test.ts`; pero su estado efectivo en el proyecto hosted solo se confirma en el dashboard tras `supabase config push`. Sigue siendo condición obligatoria de go-live.         |

**No se introdujeron regresiones.** Los 5 auditores confirmaron que los cambios del 0021 (`mask-email.ts`, `checkout/success`, `checkout-action.ts`, `create.ts`, `CheckoutForm.tsx`, `shared/constants/legal.ts`, páginas legales, migración `…033`, i18n) no debilitaron ningún control existente: pagos sólido sin cambios, RLS/grants intactos, sin secretos nuevos, sin endpoints nuevos.

---

## Veredicto global

### 🟡 GO CON CONDICIONES — condición única: **P1-2** (verificación de dashboard en el cutover)

A nivel de **código y configuración versionada, el sistema está APTO**: las dos condiciones P1 de código de la auditoría inicial están **cerradas y re-verificadas**, no hay regresiones, y **no apareció ningún P0 ni P1 nuevo** en ningún dominio. La postura de seguridad **mejoró** respecto a la auditoría inicial (de 3 condiciones P1 a 1, y la que queda no es código).

Queda **una sola condición bloqueante de producción**, que el council **no puede cerrar por diseño** (no es código):

1. **P1-2 — Confirmar en el dashboard de Supabase de PRODUCCIÓN que `enable_signup=false` está efectivamente aplicado** (vía `supabase config push` + verificación), y que el hook `custom_access_token_hook` quedó **registrado** (sin él, el claim `user_role` no se inyecta y toda la matriz de roles autenticados se degrada). Procedimiento en [`GUIA-VERIFICACION-MANUAL.md §1`](GUIA-VERIFICACION-MANUAL.md).

Cerrada esa verificación en el cutover, el veredicto pasa a **GO**. El resto de los hallazgos son P2 (primeras semanas) y P3 (mejora continua); ninguno bloquea el lanzamiento.

---

## Veredicto por dominio

| Dominio                            | Veredicto            | Bloqueantes (P1)                                                                                         |
| ---------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| Seguridad de aplicación (APPSEC)   | 🟡 APTO CON RESERVAS | Ninguno propio. Solo P3. Sin regresiones por el 0021.                                                    |
| Control de acceso (ACCESS)         | 🟡 APTO CON RESERVAS | **P1-1 CERRADO** (residuo P3 aceptado). Participa en **P1-2** (verificación de dashboard). P2/P3.        |
| Seguridad de pagos (PAYSEC)        | 🟢 APTO CON RESERVAS | **Ninguno** — los 7 controles ✓, sin regresión por el 0021. Solo P3 + 1 P2 de correctness (sobreventa).  |
| Privacidad de datos (PRIV)         | 🟡 APTO CON RESERVAS | **P1-3 CERRADO**, **P1-1 mitigado**. P2/P3 (anonimización, retención, export sin auditoría, 1 nuevo P3). |
| Infraestructura y secretos (INFRA) | 🟡 APTO CON RESERVAS | **P1-2** (INFRA-01: verificar `enable_signup` en prod). P2: password policy.                             |

Ningún dominio quedó **NO APTO**. Pagos es el dominio más fuerte (sin reserva bloqueante). Árbol e historial git: **limpios de secretos** (búsqueda ejecutada de verdad sobre `git log --all -p`).

---

## Resumen ejecutivo

El sistema llega a esta re-auditoría en **mejor estado que en la auditoría inicial**. Las dos correcciones de código del spec 0021 hacen exactamente lo que documentan, re-verificado archivo por archivo:

- **P1-1 (IDOR/PII en checkout success)**: la página de éxito ya **no** trae `customer_name` y **nunca** serializa el email completo al HTML; solo renderiza `maskEmail(customer_email)` (`j***@dominio`), calculado server-side. La exposición pasó de **PII directa** (nombre + email completos por UUID crudo) a un **identificador parcial** (primera letra + dominio del email). El patrón de acceso por UUID sin token persiste como **residuo de severidad baja (P3)**, aceptado por decisión de diseño explícita del usuario (spec 0021 §5: enmascarar en vez de tokenizar). El header `Referrer-Policy: strict-origin-when-cross-origin` evita que el UUID viaje a terceros vía `Referer`.
- **P1-3 (consentimiento)**: el checkbox es `required` (UX) y, lo importante, la server action **valida el consentimiento antes** de consumir rate-limit, crear hold, booking o payment intent — no confía en el cliente. La evidencia se persiste (`consent_at` + `consent_version`), con la versión **estampada por el server**. Las páginas `/privacy` y `/terms` existen con placeholder marcado como responsabilidad del cliente.

**Lo que sigue sólido (re-confirmado, no asumido):** pagos (los 7 controles clave ✓, sin vía de abuso económico, sin regresión por el 0021); control de acceso (RLS deny-by-default, doble barrera REVOKE+guard en las 4 funciones de dinero, separación guía/panel, todo intacto migración por migración); secretos (árbol e historial limpios, separación cliente/servidor correcta, env-validation con Zod); privacidad (minimización fuerte: cero PII del turista a OnvoPay, tokens hasheados, IP/email hasheados en rate-limit, sin cruce de PII entre reservas).

**Lo más urgente:** una sola cosa — **P1-2**, la verificación en el dashboard de producción de que el auto-registro está deshabilitado. No es código; es una casilla del cutover que, si se omite, reabre el vector de lectura de PII de guías que cerró el spec 0020.

**Recomendación:** ejecutar P1-2 (y el resto de [`GUIA-VERIFICACION-MANUAL.md`](GUIA-VERIFICACION-MANUAL.md)) en el cutover, salir a producción, y programar los P2 para las primeras semanas y los P3 como mejora continua. Para un sistema con dinero y PII, sigue recomendándose un **pentest externo** una vez antes de escalar volumen, usando este reporte como mapa.

---

## Hallazgos consolidados priorizados

### P0 — Críticos (bloquean producción)

**Ninguno.** No se encontraron vulnerabilidades críticas explotables en ningún dominio, ni preexistentes ni introducidas por el 0021.

---

### P1 — Altos (resolver antes del lanzamiento)

#### P1-2 · Verificar `enable_signup=false` (y el hook) en el Supabase de producción — **ÚNICO P1 ABIERTO**

- **IDs**: INFRA-01 + ACCESS (verificación manual) + PRIV (cross-ref).
- **Ubicación**: `supabase/config.toml:176` (config del CLI, **local/versionada**) vs proyecto hosted de producción.
- **Descripción**: `config.toml` tiene `enable_signup = false` (global) y el hook `custom_access_token_hook` con `enabled = true`, ambos correctos y cubiertos por `web/tests/integration/signup-disabled.test.ts`. Pero la config del CLI **no aplica al hosted** salvo `supabase config push`, y su estado efectivo solo se confirma en el dashboard.
- **Impacto**: si el hosted tuviera el signup habilitado, cualquiera podría auto-registrarse como `authenticated` y reabrir el vector de lectura de PII de guías que cerró el spec 0020 (la mitigación de `…032` depende de que el lector NO sea un `authenticated` sin rol). Si el hook no quedara registrado, el claim `user_role` no se inyecta y la matriz de roles autenticados se degrada.
- **Mitigación**: `supabase config push` al proyecto de prod (tras `supabase link`) + confirmar en el dashboard (Authentication → signup OFF; Hooks → `custom_access_token_hook` activo). Tras migrar, correr `secdef_functions_public_executable()` y `audit_public_executable_functions()` contra prod (deben devolver 0 filas). Ver [`GUIA-VERIFICACION-MANUAL.md §1`](GUIA-VERIFICACION-MANUAL.md).
- **Esfuerzo**: trivial (verificación de dashboard), pero **bloqueante** por su impacto y **no resoluble en código**.

#### P1-1 · IDOR / PII en checkout success — ✅ CERRADO (verificado)

Era el P1 técnico de la auditoría inicial (ACCESS-01). El spec 0021 lo cerró: `web/app/[locale]/(public)/checkout/success/page.tsx` ya no selecciona `customer_name` y enmascara el email con `web/lib/format/mask-email.ts`. Verificado por ACCESS, PRIV y APPSEC. **Residuo**: el acceso por UUID crudo sin token persiste, exponiendo solo el email enmascarado + datos de catálogo + código corto → reclasificado **P3** (ver abajo), aceptado por diseño.

#### P1-3 · Consentimiento / aviso de privacidad en el checkout — ✅ CERRADO (verificado)

Era PRIV-01. El spec 0021 lo cerró: checkbox `required` + validación server-side en `checkout-action.ts` (antes de cualquier mutación) + persistencia de `consent_at`/`consent_version` (migración `…033`, constante `shared/constants/legal.ts`) + páginas `/privacy` y `/terms`. Verificado por PRIV y APPSEC. **Pendiente del [CLIENTE]** (no del sistema): redactar el texto legal definitivo y el registro ante PRODHAB.

---

### P2 — Medios (primeras semanas post-lanzamiento)

| ID(s)                     | Título                                                                                                     | Ubicación                                                           | Mitigación                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ACCESS-02                 | Middleware solo verifica autenticación, no rol                                                             | `web/middleware.ts:30`                                              | Mitigado por defensa en profundidad (`(admin)/layout.tsx` aplica `requireAnyRole`, RLS, signup off). Agregar verificación de rol en el middleware o documentar que el choke-point real es el layout. Sin cambios.                                                  |
| ACCESS-04 + INFRA         | Service role key reutilizada como secreto HMAC del invite token                                            | `web/lib/auth/invite-set-token.ts:7-11`                             | Usar un secreto dedicado (`INVITE_SIGNING_SECRET`). Funcionalmente seguro hoy; acopla la clave más sensible.                                                                                                                                                       |
| INFRA-02 + ACCESS         | Password policy débil (`minimum_password_length=6`, sin complejidad)                                       | `supabase/config.toml:182,185` (dashboard hosted)                   | Subir a ≥8 con `lower_upper_letters_digits` (viaja por `config push`) + confirmar en dashboard. Aplica a cuentas admin/staff con acceso a panel/PII.                                                                                                               |
| PRIV-02                   | Sin capacidad de borrado/anonimización para el derecho de eliminación (Ley 8968)                           | Modelo de datos (no existe ruta/función)                            | **[SISTEMA]** operación de anonimización por email ejecutable por admin (sobrescribir `customer_name`/`customer_email`, conservar montos para contabilidad). El diseño lo facilita (PII concentrada); falta el punto de entrada. La política es del **[CLIENTE]**. |
| PRIV-03                   | Retención indefinida de tokens de acceso vencidos                                                          | `booking_access_tokens`, `guide_access_tokens` (sin job de cleanup) | **[SISTEMA]** job worker que borre `expires_at < now()` (espejo de `cleanup-rate-limits.ts`). Los índices `(…, expires_at)` ya existen.                                                                                                                            |
| PRIV-05                   | Export CSV de reservas (PII masiva) sin registro de auditoría                                              | `web/app/[locale]/(admin)/dashboard/bookings/export/route.ts`       | **[SISTEMA]** registrar el export en `audit_logs` (actor, rango, conteo). Acceso ya gateado por rol (`requireAnyRole`); falta la trazabilidad. El CSV de reportes es agregado (sin PII) — correcto.                                                                |
| PAYSEC (xref correctness) | Riesgo de sobreventa: `confirm_booking` no re-chequea `capacity_total` si un hold venció antes del webhook | `confirm_booking` (`…024`/`…029`); `release-expired-holds.ts`       | **Correctness/operacional, NO fuga de dinero** (cada reserva paga lo correcto). Si dos holds confirman tras expirar uno, puede superarse el cupo. Evaluar re-chequeo de capacidad en la confirmación. Para el `payment-flow-auditor`/correctness.                  |

---

### P3 — Hardening (mejora continua)

| ID(s)               | Título                                                                                             | Ubicación                                                                                                               | Mitigación                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACCESS-01 (residuo) | Email enmascarado + existencia de reserva visibles por UUID crudo sin token de propiedad           | `checkout/success/page.tsx:78-82`                                                                                       | Reducción fuerte ya aplicada (de PII directa a email parcial). Residuo aceptado por diseño (spec 0021 §5). A futuro: tokenizar como `/booking/[token]` si se quiere eliminación total. |
| ACCESS-03           | `checkout/cancel` libera un hold por id de reserva crudo sin token                                 | `web/app/[locale]/(public)/checkout/cancel/page.tsx:23-28`                                                              | Acotado (`pending_payment` + `status='active'`, TTL 15 min, no expone datos). Ligar a token/sesión o aceptar el riesgo dado el TTL.                                                    |
| APPSEC-01           | Validación de fecha laxa rompe el header `Content-Disposition` del export de reservas              | `web/lib/booking/admin-filters.ts:56-58`; `.../bookings/export/route.ts:25,31`                                          | Regex estricto `^\d{4}-\d{2}-\d{2}$` antes de `Date.parse`. Admin-only, sin response-splitting (CR/LF → NaN). El export de reports ya es seguro; replicar.                             |
| APPSEC-02           | `customer_name` sin cota de longitud                                                               | `checkout-action.ts:42`; `create.ts:61`; `…000012_create_bookings.sql:11`                                               | `z.string().trim().min(1).max(120)` en la action; opcional `CHECK (length <= 200)` en DB. Higiene de input (no XSS: ya se escapa con `escapeHtml`).                                    |
| APPSEC-03           | `postcss < 8.5.10` (CVE-2026-41305, moderate, transitiva por Next)                                 | `web` deps                                                                                                              | No alcanzable en runtime (la app no procesa CSS de usuario). Actualizar Next / override `postcss>=8.5.10`. Worker: `pnpm audit` limpio.                                                |
| PRIV-04             | Sentry sin `sendDefaultPii:false` explícito ni `beforeSend` scrubber                               | `web/sentry.client.config.ts`, `web/instrumentation.ts`                                                                 | Default ya no envía PII; fijar `sendDefaultPii:false` explícito y `beforeSend` que recorte email/nombre como defensa en profundidad.                                                   |
| PRIV-06             | `console.error` vuelca el objeto de error completo en checkout                                     | `web/lib/booking/checkout-action.ts:91`                                                                                 | Loguear solo `msg` (ya disponible), no el objeto `err`. Riesgo latente de PII en logs de Vercel.                                                                                       |
| **PRIV-07 (nuevo)** | El cuerpo de error de Resend (puede ecoar el email `to`) se persiste en `notifications.last_error` | `worker/src/notifications/repository.ts:108`; adapter `resend.ts:39-43`                                                 | **[SISTEMA]** truncar/recortar el email del cuerpo de error antes de persistir, o guardar solo status + código. Solo en fallos; acceso a `notifications` solo service_role/panel.      |
| PAYSEC-01           | Webhook no valida `payload.status` además del `eventType`                                          | `web/lib/payments/adapters/onvopay.ts:83-90`; `route.ts:16`                                                             | Guard `if (payload.status !== 'succeeded') return received`. No inducible por atacante (requiere firmar el webhook).                                                                   |
| PAYSEC-02           | Clave de idempotencia = id del payment-intent, no id de entrega único                              | `onvopay.ts:84`; `route.ts:77`                                                                                          | Robusto hoy (guard de estado + `ON CONFLICT`); si OnvoPay expone id de evento/entrega, usarlo. Documentar la suposición.                                                               |
| PAYSEC-03 + INFRA   | Logs server-side incluyen el payment-intent id                                                     | `route.ts:29` (+ Sentry)                                                                                                | No es exposición al cliente; confirmar retención/acceso de logs (INFRA).                                                                                                               |
| INFRA-03            | Falta `import 'server-only'` en módulos con secretos                                               | `supabase-service.ts`, `supabase-server.ts`, `payments/index.ts`, `payments/adapters/onvopay.ts`, `invite-set-token.ts` | Agregar el guard. Riesgo real bajo (Next solo inlinea `NEXT_PUBLIC_*`); es defensa en build-time.                                                                                      |
| INFRA-04 + APPSEC   | Confianza en `x-forwarded-for[0]` para rate-limit                                                  | `web/lib/security/client-ip.ts`                                                                                         | No-spoofeable solo detrás de Vercel (target confirmado). Aceptable; considerar `x-vercel-forwarded-for` para robustez extra.                                                           |
| INFRA-05            | Búsqueda/disponibilidad pública sin rate-limit propio                                              | `web/lib/booking/availability.ts`                                                                                       | Reads idempotentes sin efecto en inventario; el checkout sí está limitado. Límite holgado por IP si se observa scraping.                                                               |
| INFRA (CSP parcial) | `'unsafe-inline'` en CSP `script-src`/`style-src`                                                  | `web/next.config.ts`                                                                                                    | Limitación documentada de hidratación Next 15/React 19. Endurecer a nonces es trabajo futuro. `'unsafe-eval'` ya está correctamente limitado a dev.                                    |

---

## Contradicciones resueltas

**1. Severidad del residuo de ACCESS-01 tras el enmascarado (ACCESS vs PRIV vs APPSEC).**

No hubo discrepancia de fondo: los tres auditores coincidieron en que P1-1 quedó **cerrado a un residuo de severidad baja**. ACCESS lo calificó "CERRADO (mitigación fuerte; residuo bajo aceptado)"; PRIV lo calificó "MITIGADO, riesgo residual BAJO, aceptable para producción"; APPSEC lo marcó como cross-ref de residuo, ya aceptado en el spec. PRIV planteó la pregunta de si ACCESS acepta el residuo o exige tokenización, y **ACCESS la respondió explícitamente**: acepta el residuo dado que (a) la exposición pasó de PII directa a un identificador parcial (primera letra + dominio), (b) el UUIDv4 no es trivialmente enumerable y no hay grant DB a anon, (c) `Referrer-Policy` corta la fuga a terceros, y (d) es decisión de diseño documentada del usuario (enmascarar vs tokenizar). **Juicio del coordinador**: P1-1 **CERRADO**; el residuo se registra como **P3** (`ACCESS-01 residuo`), no bloqueante. Si en el futuro se quisiera eliminación total de la exposición, el patrón de token (`/booking/[token]`) ya existe en el repo.

**2. ¿P1-2 mantiene el veredicto global en "con condiciones" si el código está limpio?**

Sí, y es deliberado. INFRA y ACCESS coinciden en que el flag está **correcto y versionado** en `config.toml` y cubierto por test, pero que su estado **efectivo** en producción no es verificable desde el repo. El council audita código y configuración versionada; **no puede cerrar P1-2 por sí mismo**. Por honestidad sobre los límites de la auditoría (regla inviolable), el veredicto global se mantiene en **GO CON CONDICIONES** con P1-2 como única condición, en lugar de declarar un GO que el código no puede garantizar. No es una contradicción entre auditores, sino un límite de alcance declarado.

No hubo otras discrepancias de fondo: las valoraciones de los 5 auditores coincidieron y los cross-refs fueron consistentes.

---

## Matriz de cobertura

| Dominio                    | Estado      | Justificación                                                                                                                                                                                                               |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seguridad de aplicación    | 🟡 Amarillo | Sin injection/XSS/SSRF/redirect explotables (re-verificado en HEAD). Cambios del 0021 limpios. Solo P3 preexistentes (validación de fecha admin-only, cota de nombre, CVE transitiva no alcanzable).                        |
| Control de acceso          | 🟡 Amarillo | **P1-1 cerrado** (residuo P3 aceptado). RLS/grants/funciones SECURITY DEFINER intactos, re-verificados migración por migración (incluida la nueva `…033`, que no toca RLS). Participa en P1-2 (dashboard). P2/P3 conocidos. |
| Seguridad de pagos         | 🟢 Verde    | Los 7 controles clave ✓ con evidencia; **sin regresión** por el cambio de checkout del 0021. Sin vía de abuso económico. Solo P3 + 1 P2 de correctness (sobreventa).                                                        |
| Privacidad de datos        | 🟡 Amarillo | **P1-3 cerrado**, **P1-1 mitigado**. Minimización fuerte y sin fuga activa. Faltan anonimización (P2), cleanup de tokens (P2), audit de export (P2); 1 nuevo P3 (PRIV-07).                                                  |
| Infraestructura y secretos | 🟡 Amarillo | Sin secretos en árbol ni historial (búsqueda ejecutada); headers y env-validation completos; **sin regresión** por el 0021. Pendiente de dashboard: **P1-2** (signup prod) y password policy (P2).                          |

Leyenda: 🟢 sólido / 🟡 sólido con reservas a cerrar / 🔴 bloqueante abierto. **Ningún dominio en rojo.**

---

## Límites de esta auditoría

El council audita **código y configuración versionada**. **No** verifica lo que depende de dashboards, del sistema corriendo o de un humano atacando en vivo. Antes de producción, ejecutar las verificaciones de [`GUIA-VERIFICACION-MANUAL.md`](GUIA-VERIFICACION-MANUAL.md). Las más críticas tras esta re-auditoría:

- **Supabase (dashboard) — P1-2, BLOQUEANTE**: confirmar `enable_signup=false` efectivo en prod y el hook `custom_access_token_hook` registrado, tras `supabase config push`. Además: RLS real por tabla, password policy ≥8 (P2), Storage buckets, pooling, cifrado en reposo. Correr `secdef_functions_public_executable()` y `audit_public_executable_functions()` (deben dar 0 filas).
- **Vercel**: env scopeadas por ambiente (preview ≠ secretos de prod), protección de previews, redirect HTTP→HTTPS y certificado, logs sin secretos/PII. WAF/edge que rechace CR/LF en headers (defensa extra a APPSEC-01).
- **Railway (worker)**: env sin filtrarse en logs, sin puertos públicos innecesarios.
- **OnvoPay**: `ONVOPAY_WEBHOOK_SECRET` del dashboard coincide con el desplegado, URL del webhook correcta, llaves `onvo_live_` solo en prod, KYC activa, comportamiento real de refunds en sandbox (doble POST sin doble crédito), cobro/reporte en USD.
- **Resend**: dominio verificado, SPF/DKIM/DMARC, API key con permisos mínimos, retención del cuerpo HTML con PII, si los cuerpos de error filtran `to` (PRIV-07).
- **Con el sistema corriendo**: que `POST /auth/v1/signup` esté efectivamente rechazado; tampering de montos con tarjeta de prueba; IDOR sobre magic links; webhooks falsificados y replay; rate-limiting en vivo; PII en los 5 emails reales; ausencia de PII completa en el HTML de `checkout/success` (solo email enmascarado).
- **Pentest profesional externo**: recomendado al menos una vez antes de escalar volumen. Este reporte sirve de mapa.
- **Revisión legal**: Ley 8968 (PRODHAB), obligaciones fiscales/ICT, T&C — responsabilidad del cliente. Reemplazar el placeholder de `/privacy` y `/terms` antes de operar con datos reales e incrementar `PRIVACY_NOTICE_VERSION` al cambiar el texto.

---

## Anexos — Reportes detallados por auditor

### Anexo A — appsec-auditor

#### Veredicto del dominio

**APTO CON RESERVAS** — Los cambios del spec 0021 son seguros y bien implementados: la validación server-side de consentimiento es correcta y se ejecuta antes de cualquier mutación de estado, el helper `maskEmail` maneja input raro sin romper ni filtrar, las páginas/constantes legales no introducen superficie de ataque, y la migración es un ALTER aditivo limpio. No se introdujeron regresiones. Mis tres hallazgos previos (APPSEC-01/02/03) **siguen abiertos**, pero los tres son P3 no bloqueantes (estaban fuera del alcance declarado del 0021). No hay vulnerabilidad de código explotable nueva ni preexistente que bloquee producción.

#### Cobertura

Re-verificado en HEAD (`fix/0021-cierre-p1-auditoria-council`, working tree limpio):

- **Archivos nuevos/tocados del 0021**: `web/lib/format/mask-email.ts`, `web/app/[locale]/(public)/checkout/success/page.tsx`, `web/lib/booking/checkout-action.ts`, `web/lib/booking/create.ts`, `web/components/public/CheckoutForm/CheckoutForm.tsx`, `shared/constants/legal.ts`, `web/components/public/LegalPage/LegalPage.tsx`, páginas `(public)/privacy/page.tsx` y `(public)/terms/page.tsx`, migración `20260612000033_add_booking_consent.sql`, i18n `web/locales/{es,en}.json`.
- **Re-verificación de hallazgos previos**: `web/lib/booking/admin-filters.ts`, `.../dashboard/bookings/export/route.ts` (APPSEC-01); `checkout-action.ts` + `20260527000012_create_bookings.sql` + `shared/schemas.ts` (APPSEC-02); `pnpm audit --prod` en `web/` y `worker/` (APPSEC-03).
- **Barrido de dominio**: todos los `.rpc()` (parámetros tipados, sin SQL armado), `dangerouslySetInnerHTML`/`eval`/`new Function`/`child_process` (cero en runtime), escape de HTML en los 5 templates de email (`worker/src/notifications/templates/*` + `format.ts`), filtro PostgREST `.or()` con `sanitizeSearch` (`web/lib/booking/repository.ts:35,57`), `startOfDay`/`endOfDay` con sufijos fijos.
- **Fuera de alcance** (referido a otros auditores): IDOR residual de PII por UUID en checkout success (PRIV/ACCESS), RLS y confianza en claim JWT (ACCESS), `enable_signup` en prod (INFRA, P1-2).
- **No verificable solo desde código**: que el WAF/edge de Vercel rechace CR/LF en headers; comportamiento real de OnvoPay/Resend.

`.claude/memory/*.md` no existe (charter lo anticipaba); fuente de verdad = código real + `docs/specs/`.

#### Vulnerabilidades críticas / altas / medias

Ninguna.

#### Vulnerabilidades bajas

- **APPSEC-01: ABIERTO (sin cambios) | `web/lib/booking/admin-filters.ts:56-58` + `.../dashboard/bookings/export/route.ts:25,31`** | Validación de fecha laxa rompe el header `Content-Disposition`. `validateExportRange` usa `Date.parse(filters.dateFrom)` directo sin normalizar. PoC re-confirmado: `Date.parse('2026-01-01"')` → válido, por lo que `?dateFrom=2026-01-01"` inyecta la comilla en `Content-Disposition`, rompiendo el entrecomillado. Sin response-splitting (CR/LF → NaN). Vector limitado (admin-only). Mitigación: regex estricto `^\d{4}-\d{2}-\d{2}$`.
- **APPSEC-02: ABIERTO (sin cambios) | `checkout-action.ts:42` + `create.ts:61` + `…000012_create_bookings.sql:11`** | `customer_name` sin cota de longitud. El checkout público toma `name` con solo `.trim()` y no-vacío, sin `max()`. La columna `customer_name text NOT NULL` no tiene CHECK. Vector: un `name` de varios MB se persiste e infla el payload del email a Resend. No es XSS (se escapa con `escapeHtml`). Mitigación: `z.string().trim().min(1).max(120)`.
- **APPSEC-03: ABIERTO (sin cambios) | dependencia `postcss < 8.5.10` (CVE-2026-41305, moderate) en `web`** | `pnpm audit --prod` re-ejecutado: 1 moderate, path `.>next>postcss`. No alcanzable en runtime. Worker: sin vulnerabilidades. Mitigación: actualizar Next / override `postcss>=8.5.10`.

#### Verificación de los cambios del 0021 (sin hallazgos)

- **Consentimiento server-side** (`checkout-action.ts:49-60`): `formData.get('consent') != null` se valida en el guard junto con `!customerName`/`!instanceId`/email **antes** de rate-limit (`:73`), hold y booking. No confía en el `required` del cliente. La versión la estampa el server (`create.ts:71`). **Correcto.**
- **`maskEmail`** (`mask-email.ts:11-17`): `at < 1` cubre sin `@` y `@` en posición 0; dominio vacío → `''`. El llamador (`success/page.tsx:78`) solo renderiza si el resultado es truthy, vía JSX (auto-escape). El email crudo nunca se serializa. **Correcto.**
- **Success page** (`success/page.tsx:21-25`): el `select` ya no incluye `customer_name`. No rompe con UUID malformado. **Correcto.**
- **Páginas legales / LegalPage / i18n**: contenido de `getTranslations`, JSX (auto-escape), sin `dangerouslySetInnerHTML`. `consent-label` usa `t.rich` con `<a rel="noopener noreferrer">`. `success-name` eliminada. **Correcto.**
- **Migración `…000033`**: ALTER aditivo de dos columnas nullable, sin SQL dinámico. **Correcto.**

#### Requiere verificación manual o pentesting

- Confirmar en runtime que el WAF/edge de Vercel rechaza headers con CR/LF (defensa adicional a APPSEC-01).
- Confirmar que `POST /auth/v1/signup` está efectivamente rechazado en el stack corriendo (cubre P1-2).
- Pentest del flujo de magic link (booking/guide tokens): fijación/replay más allá de expiración + hash SHA-256 (código re-confirmado correcto).

#### Referencias cruzadas

- **PRIV/ACCESS (residuo de P1-1)** — `success/page.tsx:21-25` sigue usando `createSupabaseServiceClient()` y lee por `searchParams.booking` (UUID crudo, sin token). El 0021 redujo la exposición a solo email enmascarado; el patrón persiste por decisión documentada.
- **ACCESS** — `web/lib/auth/server.ts` `decodeUserRole` decodifica el JWT sin verificar firma (seguro porque `getUser()` valida antes).
- **INFRA** — `client-ip.ts` (rate-limit por primer `X-Forwarded-For`); `enable_signup` en prod (P1-2).

**Notas positivas re-confirmadas en HEAD**: sin SQL injection (todos los `.rpc()` con parámetros tipados); XSS de emails neutralizado (`escapeHtml`); filtro `.or()` con `sanitizeSearch`; CSV formula injection cubierta; sin `dangerouslySetInnerHTML`/`eval`/`child_process` en runtime; sin SSRF ni open redirect nuevos.

---

### Anexo B — access-control-auditor

#### Veredicto del dominio

**APTO CON RESERVAS** — El modelo de autorización sigue siendo sólido y todo el hardening previo (RLS deny-by-default en tablas sensibles, funciones SECURITY DEFINER con `search_path=''`, doble barrera anon/authenticated REVOKE + guard `is_public_request()` en las 4 funciones de dinero, separación guía/panel, magic links hasheados, signup global off) está **intacto y re-verificado migración por migración**. El P1-1 (ACCESS-01) — el único bloqueante técnico de mi dominio — quedó **CERRADO en lo práctico**: la página ya no trae `customer_name` y nunca serializa el email completo, solo el enmascarado. La reserva que mantiene el veredicto en "con reservas" no es nueva ni bloqueante: el residuo aceptado de ACCESS-01 + los P2/P3 ya conocidos (ACCESS-02/03/04). No hay P0 ni P1 abiertos en control de acceso. El único pendiente bloqueante de go-live es P1-2, **verificación de dashboard, no código**.

#### Cobertura

- **33 migraciones** (`20260523000001` → `20260612000033`), re-leídas íntegras (cada `CREATE TABLE`, `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT/REVOKE`, `CREATE FUNCTION`). Énfasis en las de hardening (`…026/028/029/030/031/032`) y la nueva `…033`.
- **Cambio 0021 verificado por diff**: success page, `mask-email.ts`, `CheckoutForm.tsx`, `checkout-action.ts`, `create.ts`, páginas `/privacy` y `/terms`, `LegalPage.tsx`, `shared/constants/legal.ts`.
- **Diff acumulado** sobre `supabase/`, `web/lib/auth/`, `web/middleware.ts`: único cambio = migración 033 aditiva. RLS/grants/middleware/auth core **no se tocaron**.
- **Auth core / route guards / actions**: `auth/server.ts`, `middleware.ts`, `(admin)/layout.tsx`, `guides/guide-view.ts`, `guides/token.ts`, `booking/access-token.ts`, `booking/cancel-action.ts`. Tokens de magic link y `config.toml`.

#### Verificación de cierre de hallazgos previos

- **ACCESS-01 (P1-1): CERRADO (mitigación fuerte; residuo bajo aceptado).** `checkout/success/page.tsx:23,78-82`: la query pasó de `select('id, customer_name, customer_email, …')` a `select('id, customer_email, tour_instance_id, status')` — `customer_name` ya NO se trae. El email se lee solo para enmascararse vía `maskEmail`; el valor crudo nunca se asigna a JSX. Lo único renderizado: código corto, nombre de tour, fecha (catálogo público) y email enmascarado. Severidad residual **BAJA**: con un UUID en la URL un tercero ve `j***@dominio` sin token de propiedad. Decisión de diseño explícita (spec 0021 §5). No bloquea go-live.
- **ACCESS-02 (P2): ABIERTO (sin regresión).** `middleware.ts:30` verifica solo `!user`. Mitigado por `(admin)/layout.tsx:18` (`requireAnyRole`) + RLS + signup off.
- **ACCESS-03 (P3): ABIERTO (sin regresión, menos PII).** `checkout/cancel/page.tsx:16-29` libera `tour_holds` por `?booking=<uuid>` sin token, gateado por `.eq('status','active')` + `pending_payment`. Esta página **no selecciona PII**.
- **ACCESS-04 (P2): ABIERTO (sin regresión).** HMAC del invite usa service role key. Funcionalmente seguro. Cruce con INFRA.

#### Regresiones introducidas por el spec 0021

Ninguna. La migración 033 solo agrega `consent_at`/`consent_version` nullable; **no** crea/modifica políticas RLS, **no** otorga/revoca grants, **no** abre lectura. Las páginas `/privacy` y `/terms` renderizan i18n estático, cero acceso a datos. El consentimiento se exige server-side antes de rate-limit/hold/booking, sin ruta de lectura nueva.

#### Matriz de acceso verificada

| Rol                | Recurso/Acción                                                       | ¿Permitido?                                                | ¿Bien restringido? | Evidencia                                                                                                |
| ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| anon               | catálogo (tours/pricing/schedules/instances activos/futuros)         | Sí                                                         | Sí                 | `…010` políticas `*_select_anon` con filtros; sin PII                                                    |
| anon               | bookings/payments/users/refunds/tokens/rate_limits/holds (PostgREST) | No                                                         | Sí                 | RLS sin políticas + `REVOKE SELECT … FROM anon` (`…009`); cero `GRANT … TO anon`                         |
| anon/authenticated | ejecutar RPC privilegiadas (dinero/hold/rate-limit)                  | No                                                         | Sí                 | `…028`/`…029` `REVOKE EXECUTE … FROM anon, authenticated`; guard `is_public_request()`; `…031` regresión |
| anon               | auto-registro (`/auth/v1/signup`)                                    | No                                                         | Sí (código)        | `config.toml:176` `enable_signup=false` global — **estado en prod = P1-2 manual**                        |
| staff              | leer bookings/payments/notifications/refunds/audit_logs              | Sí                                                         | Sí                 | políticas `*_select_admin_staff` `IN ('admin','staff')`                                                  |
| staff              | leer PII de otros admin/staff en `users`                             | No                                                         | Sí                 | `…026`+`…032`: solo su fila + guías                                                                      |
| staff              | leer PII de guías (panel salidas)                                    | Sí (panel)                                                 | Sí                 | `…032` condiciona `role='guide'` a lector `IN('admin','staff')`                                          |
| staff              | crear/editar/borrar usuarios                                         | No                                                         | Sí                 | `users_insert/update/delete` exigen `'admin'`; actions con `requireRole(Admin)`                          |
| staff              | config crítica tours/pricing/schedules                               | No                                                         | Sí                 | políticas `*_admin` exigen `'admin'`                                                                     |
| staff              | asignar guías, check-in, cancelar, retry refund                      | Sí                                                         | Sí                 | actions con `requireAnyRole(ADMIN_PANEL_ROLES)` antes del service_role                                   |
| guide              | ver sus salidas/instancias                                           | Sí (token)                                                 | Sí                 | `guide-view.ts:63-77` valida token hasheado, filtra `guide_id` derivado                                  |
| guide              | ver PII de turistas                                                  | No                                                         | Sí                 | `guide-view.ts:50` solo `passengerCount` (agregado)                                                      |
| guide              | ver salidas de otros guías / cambiar su rol o `active`               | No                                                         | Sí                 | `.eq('guide_id', guideId)`; sin login propio; `users_update_self` impide cambio de rol                   |
| turista            | ver/cancelar su reserva                                              | Sí (token)                                                 | Sí                 | `/booking/[token]` y `cancelByToken` resuelven por hash                                                  |
| turista            | ver PII de otra reserva por id crudo                                 | **No (nombre/email completo)** / **parcial (enmascarado)** | **Mitigado**       | `checkout/success` ya no trae `customer_name`; muestra `j***@dominio` (ACCESS-01 cerrado)                |
| turista            | liberar hold de otra reserva por id crudo                            | Sí (acotado)                                               | Parcial (P3)       | `checkout/cancel:23-28` sin token; gateado por `pending_payment`+`active`, TTL 15 min (ACCESS-03)        |
| turista/anon       | confirmar reserva sin pagar / refund arbitrario vía RPC              | No                                                         | Sí                 | `…028`/`…029`/`…030` + guard de identidad                                                                |

#### Tablas/endpoints sin RLS o autorización detectados

- **Tablas sin RLS: ninguna.** Las 17 tablas con `ENABLE ROW LEVEL SECURITY`. La nueva columna de `bookings` (033) no altera su RLS.
- **Endpoints públicos que leen `bookings` por id crudo con service_role**: `checkout/success` (ahora sin PII completa) y `checkout/cancel` (sin PII, muta hold acotado).

#### Vulnerabilidades

**Críticas / Altas:** Ninguna abierta. ACCESS-01 cerrado a residuo bajo.
**Medias (P2):** ACCESS-02 (middleware sin rol, mitigado), ACCESS-04 (HMAC con service role key).
**Bajas (P3):** ACCESS-03 (cancel libera hold por id crudo, acotado), ACCESS-01 residuo (email enmascarado por UUID crudo).

#### Requiere verificación manual

- **P1-2 (bloqueante go-live, NO código):** confirmar en el dashboard de prod `enable_signup=false` efectivo y hook `custom_access_token_hook` registrado.
- Correr `secdef_functions_public_executable()` y `audit_public_executable_functions()` contra prod (0 filas).
- Confirmar que no haya políticas/grants creados a mano fuera de migraciones.
- Confirmar que ningún endpoint público devuelva listados de booking ids (no enumerabilidad).

#### Referencias cruzadas

- **PRIV**: ACCESS-01 residual expone PII parcial por id crudo; origen acceso, impacto privacidad. El consentimiento (033) es de PRIV.
- **INFRA**: ACCESS-04 (service role como secreto HMAC); P1-2 (signup en prod); `minimum_password_length=6` (P2).
- **PAYSEC**: integridad de las 4 funciones de dinero re-verificada desde autorización.

---

### Anexo C — payments-security-auditor

#### Veredicto del dominio

**APTO CON RESERVAS** — El flujo de dinero sigue sólido y defendido en profundidad. **El cierre de P1-3 (consentimiento) NO rompió ni debilitó ningún control de pago**: el precio sigue 100% server-side, el payment intent se crea con el monto recalculado, y el orden de validaciones es correcto (consent → cantidades → rate-limit → hold → booking → payment). No se encontró ninguna vía nueva para crear booking/payment intent saltando el precio autoritativo. Los 7 controles clave siguen ✓. Mis 3 hallazgos previos (PAYSEC-01/02/03) persisten sin cambios, todos P3. El cross-ref de sobreventa persiste sin cambios (correctness, no fuga de dinero).

#### Cobertura

Re-verificado archivo por archivo (rama `fix/0021-cierre-p1-auditoria-council`):

- **Cadena de checkout (foco de regresión 0021)**: `checkout-action.ts`, `create.ts`, `checkout-pricing.ts`, `pricing-math.ts`, `quantities.ts`, `availability.ts`; `pricing/active-filter.ts`; `CheckoutForm.tsx`; `shared/constants/legal.ts`.
- **Pagos**: `payments/index.ts`, `types.ts`, `adapters/onvopay.ts`; webhook `route.ts`.
- **Cancelación/refund**: `cancel.ts`, `cancel-action.ts`, `admin-detail.ts`; `refunds/retry-action.ts`; `policies.ts`; `money.ts`, `mask-email.ts`.
- **Worker**: `refunds/onvopay.ts`, `refunds/repository.ts`, `jobs/process-refunds.ts`, `reconciliation/*`, `jobs/reconcile-pending-payments.ts`, `jobs/release-expired-holds.ts`.
- **Migraciones de dinero**: `…011/012/018/019/020/023/024/025/028/029/030`, **`…033` (consent — nuevo)**.
- **Git**: desde la auditoría inicial los ÚNICOS cambios en archivos de dinero son los 2 commits de consent del 0021.

#### Checklist de controles clave

- **[✓] Cálculo de precio server-side, sin confiar en el cliente** — `checkout-action.ts:41-67` lee de `FormData` SOLO `instance_id`, `name`, `email`, `consent`, cantidades; **ningún campo de precio**. `initCheckout` (`create.ts:46-51`) calcula con `resolveAuthoritativeCharge` → `computeAuthoritativeTotal` desde `tour_pricing`. Intent y `payments` con `totalAmountCents` recalculado (`create.ts:79-90`). El consent no añadió superficie de monto.
- **[✓] Verificación del secreto del webhook antes de confirmar, constante en tiempo** — `route.ts:10-14` llama `verifyWebhook` ANTES de tocar la DB; falla → 400. `secretMatches` (`onvopay.ts:35-40`) usa `crypto.timingSafeEqual`.
- **[✓] Confirmación solo desde fuente confiable** — Único llamador de `confirm_booking` en web: webhook verificado (`route.ts:73`). El otro: `confirmRecoveredBooking` (`reconciliation/repository.ts:78`), tras GET server-side a OnvoPay con `succeeded` + monto/moneda OK. El `onSuccess` del widget solo navega a `/checkout/success`. `is_public_request()` + REVOKE impiden ejecución por anon.
- **[✓] Política de cancelación/refund server-side con hora del servidor** — `computeRefund` (`policies.ts:30-41`) usa `now` server-side; el cliente solo envía el token. El monto se capea a `payments.amount_cents` (`…029:190-194`).
- **[✓] Anti-replay / idempotencia dentro de la transacción** — `confirm_booking` (`…029:65-69`) inserta `processed_webhook_events(p_event_id)` con `ON CONFLICT DO NOTHING` DENTRO de la transacción, antes del `SELECT … FOR UPDATE`; rollback deshace ambos. Tests cubren rollback, reentrega secuencial y concurrente.
- **[✓] Refund atómico, sin doble refund ni monto mayor al pagado** — `settle_refund` (`…029:218-266`) en una transacción, idempotente. `process-refunds.ts:87` reclama la fila (single-flight) antes de postear. Monto desde `refund.amount_cents` (capado a lo pagado). Índice único parcial `refunds_one_active_per_booking`.
- **[✓] Integridad booking↔payment** — `payments` con `UNIQUE(external_provider, external_payment_id)`. El webhook compara `amountCents`+`currency` (normalizada) contra `payment`; discrepancia → `flag_payment_mismatch`, NO confirma. La reconciliación aplica lo mismo.

#### Vulnerabilidades críticas / altas / medias

Ninguna. (Sin regresión del 0021; sin vía de abuso económico.)

#### Vulnerabilidades bajas / informativas (re-verificadas, persisten)

- **PAYSEC-01 | `onvopay.ts:83-90` + `route.ts:16`** | El webhook no valida `payload.status === 'succeeded'`, solo el `eventType`. Riesgo ~nulo (no inducible sin el secreto). Mitigación: guard `if (payload.status !== 'succeeded') return received`.
- **PAYSEC-02 | `onvopay.ts:84,86` + `route.ts:77`** | Clave de idempotencia = id del payment-intent, no id de entrega. Robusto hoy. Mitigación: usar id de entrega si OnvoPay lo expone.
- **PAYSEC-03 | `route.ts:29` (+ Sentry)** | Logs server-side incluyen el payment-intent id. No es exposición al cliente. Mitigación: confirmar retención/acceso de logs (INFRA).

#### Observación de regresión 0021 (verificada, sin hallazgo)

El cierre de P1-1 (`success/page.tsx`) no selecciona `customer_name` y enmascara el email server-side. Fuera de mi dominio (ACCESS/PRIV) — no hay mutación de dinero en esa página. `cancel/page.tsx:23-28` sigue liberando `tour_holds` por UUID crudo (ACCESS-03) — sin efecto de dinero.

#### Requiere verificación manual o pentesting

- Config real del webhook en el dashboard de OnvoPay (secreto coincidente, HTTPS, reintentos). Rotación manual del secreto compartido.
- Comportamiento real de OnvoPay ante refund parcial/duplicado (doble POST sin doble crédito si el single-flight fallara).
- Pentest de `/api/webhooks/onvopay`: fuzzing, replay con secreto válido, `paymentId` inexistente → 404 sin efectos.
- Moneda CRC vs USD en prod (el checkout fija `CHECKOUT_CURRENCY = 'USD'`).

#### Referencias cruzadas

- **ACCESS / correctness (sobreventa, NO PAYSEC)** — `confirm_booking` (`…029:86-88`) incrementa `capacity_reserved` sin re-chequear `capacity_total`. Si un hold expira antes del webhook, otro hold puede tomar el cupo y ambas reservas confirman, superando `capacity_total`. **No es hueco de dinero**; riesgo operativo. (P2.)
- **ACCESS/PRIV** — IDOR residual en `checkout/success`/`cancel`. Mitigado por el masking del 0021.
- **INFRA-SECRETS** — gestión/rotación de `ONVOPAY_*`; retención de logs con payment-intent ids (PAYSEC-03).
- **APPSEC** — `secretMatches` early-return por longitud; parsing Zod del webhook (cubierto por tests).

---

### Anexo D — data-privacy-auditor

#### Veredicto del dominio

**APTO CON RESERVAS** — Las dos condiciones P1 que tocaban privacidad quedaron cerradas y bien implementadas: **PRIV-01 (consentimiento) CERRADO** y **P1-1 (exposición de PII en checkout success) MITIGADO a riesgo residual bajo**. La minimización del dominio sigue fuerte y re-verificada (cero PII del turista a OnvoPay, reports CSV agregado, tokens hasheados, IP/email hasheados en rate_limits, emails sin cruce de PII entre reservas, PII de guías restringida al panel). Lo que mantiene el "con reservas" son los mismos P2/P3 conocidos (PRIV-02/03/04/05/06) + un nuevo P3 (PRIV-07). Ninguno es fuga activa. No hay regresiones del 0021. El dominio NO bloquea el go-live.

#### Cobertura

33 migraciones; P1-3 (`CheckoutForm.tsx`, `checkout-action.ts`, `create.ts`, `shared/constants/legal.ts`, `LegalPage.tsx`, `/privacy`, `/terms`, i18n); P1-1 (`checkout/success`, `mask-email.ts`, `checkout/cancel`, `next.config.ts` Referrer-Policy); `worker/src/notifications/` completo; exports CSV; logging/Sentry; PII a terceros (OnvoPay/Resend); búsqueda de función de anonimización/borrado (no existe).

#### Inventario de PII

| Dato                       | Tabla/Campo                                                 | Origen                     | Flujos (destinos)                                                | Tercero               |
| -------------------------- | ----------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------- | --------------------- |
| Nombre del turista         | `bookings.customer_name`                                    | Checkout                   | DB → email → CSV admin → panel. **YA NO** a la página de éxito   | Resend                |
| Email del turista          | `bookings.customer_email` + `notifications.recipient_email` | Checkout                   | DB → email → CSV admin → panel → página de éxito **enmascarado** | Resend                |
| Consentimiento (evidencia) | `bookings.consent_at`, `consent_version`                    | Checkout (server-stamped)  | DB (solo evidencia); no se expone                                | —                     |
| Teléfono del turista       | — **NO se recolecta**                                       | —                          | —                                                                | —                     |
| Nombre staff/guía          | `users.full_name`                                           | Alta por admin             | DB → panel; nombre del guía → su email                           | Resend (solo al guía) |
| Email staff/guía           | `users.email`                                               | Alta por admin             | DB → panel admin; login                                          | Supabase Auth         |
| Teléfono del guía          | `users.phone`                                               | Alta por admin             | DB → solo lista admin-only. NO a emails                          | —                     |
| Datos de tarjeta           | **NO tocan el sistema**                                     | Widget OnvoPay client-side | Browser → OnvoPay directo                                        | OnvoPay               |
| Monto/moneda/tour          | `payments`, intent OnvoPay                                  | Server                     | DB → OnvoPay (sin nombre/email)                                  | OnvoPay               |
| IP del cliente             | `rate_limits.key` **hasheada SHA-256**                      | `x-forwarded-for`          | Hash antes de persistir; purga a 24h                             | —                     |
| Error de proveedor email   | `notifications.last_error`                                  | Respuesta de Resend        | DB (puede ecoar `to`)                                            | —                     |
| actor_id (staff)           | `audit_logs.actor_id`                                       | Cancelaciones/refunds      | DB → panel. `metadata` sin nombre/email                          | —                     |
| Token de acceso            | `*_access_tokens.token_hash` (SHA-256)                      | Worker al emitir email     | Plano solo en email/URL; en DB solo hash                         | —                     |

#### Hallazgos críticos

Ninguno. No se detectó fuga activa de PII.

#### Estado de hallazgos previos

- **PRIV-01 (consentimiento) — CERRADO.** Persistencia real (`create.ts:70-71`, migración `…033`); versión estampada por el server (`PRIVACY_NOTICE_VERSION`); validación server-side antes de rate-limit/hold/booking (`checkout-action.ts:49,54`); texto legal marcado como [CLIENTE] (placeholder `[PENDIENTE…]` en `/privacy` y `/terms`); enlaces con `rel="noopener noreferrer"`.
- **P1-1 (PII en checkout success) — MITIGADO, residuo BAJO.** No selecciona `customer_name`; enmascara el email (`maskEmail`). Un UUID filtrado revela email enmascarado + tour + fecha + código corto. `Referrer-Policy: strict-origin-when-cross-origin` evita la fuga del UUID a terceros. Aceptable para producción.
- **PRIV-02 (sin borrado/anonimización) — ABIERTO (P2).** No existe función/ruta de erasure. El diseño lo facilita (PII concentrada); falta el punto de entrada.
- **PRIV-03 (retención indefinida de tokens) — ABIERTO (P2).** `booking_access_tokens`/`guide_access_tokens` sin job de purga; índices ya existen.
- **PRIV-04 (Sentry sin `sendDefaultPii:false`) — ABIERTO (P3).** Default no envía PII; recomendable fijarlo explícito + `beforeSend`.
- **PRIV-05 (export CSV de PII sin auditoría) — ABIERTO (P2).** Gateado por `requireAnyRole`, pero no escribe en `audit_logs`. Incluye nombre + email del rango.
- **PRIV-06 (`console.error` vuelca el objeto de error) — ABIERTO (P3).** `checkout-action.ts:91` loguea `err` completo.

#### Hallazgos nuevos / regresiones del 0021

Sin regresiones. Un nuevo hallazgo informativo:

- **PRIV-07 (nuevo, BAJO/P3) | `worker/src/notifications/repository.ts:108` + adapter `resend.ts:39-43`** | El cuerpo de error de Resend (puede ecoar el `to` = email del turista) se persiste en `notifications.last_error`. Solo en fallos; acceso solo service_role/panel. Mitigación [SISTEMA]: truncar/recortar el email antes de persistir, o guardar solo status + código.

#### Responsabilidad del cliente (no del sistema)

- Redactar y publicar el **aviso de privacidad** y los **T&C** (el sistema ya muestra el punto de consentimiento y enlaza a `/privacy` y `/terms` con placeholder). Reemplazar los placeholders `[PENDIENTE…]` antes de recolectar datos reales e incrementar `PRIVACY_NOTICE_VERSION` al cambiar el texto.
- **Registro ante PRODHAB** si aplica.
- Definir la **política de retención** formal (el sistema debe poder ejecutarla — PRIV-02/03).
- **Atender los derechos** de acceso/rectificación/eliminación (PRIV-02).
- Acuerdo de **encargado de tratamiento** con Resend, Supabase y OnvoPay.

#### Requiere verificación manual

- Cifrado en reposo de Supabase (dashboard).
- Retención de PII en logs de Vercel/Railway (el `err` de PRIV-06; URLs de magic link con token).
- Resend: dominio verificado + SPF/DKIM/DMARC; API key con permisos mínimos; si los cuerpos de error filtran `to` (PRIV-07).
- PII en los 5 emails reales (confirmar visualmente que ninguno filtra datos de terceros).

#### Referencias cruzadas

- **ACCESS**: P1-1 nació como ACCESS-01; la mitigación por enmascaramiento reduce el impacto de privacidad pero no cierra el patrón de acceso por UUID. La restricción de PII de guías (`…032`) re-verificada y correcta.
- **INFRA**: P1-2 (`enable_signup=false` en prod); si el signup hosted estuviera abierto, se reabre el vector de lectura de PII de guías. `Referrer-Policy`/HSTS ya en `next.config.ts`.
- **APPSEC**: escape HTML de la PII en plantillas; `customer_name` sin cota (APPSEC-02) sigue propagándose a Resend.
- **PAYSEC**: minimización hacia OnvoPay re-verificada (cero PII del turista en el intent).

---

### Anexo E — infra-secrets-auditor

#### Veredicto del dominio

**APTO CON RESERVAS** — La superficie de infraestructura y el manejo de secretos siguen sólidos y **no se degradaron con el spec 0021**. Re-verificado desde cero: árbol e historial git completo **limpios de secretos reales**; separación cliente/servidor correcta (solo 4 vars `NEXT_PUBLIC_*`, ninguna sensible); validación de env con Zod intacta; headers de seguridad completos; sin CORS permisivo; sin endpoints de debug; worker sin puerto HTTP. Las regresiones del 0021 no introdujeron secretos, env nuevas sin validar ni endpoints expuestos. La reserva que mantiene el amarillo es la misma: **P1-2 (INFRA-01) no se cierra solo con código**. Persisten INFRA-02 (P2) e INFRA-03/04/05 (P3), sin cambios.

#### Cobertura

`web/next.config.ts`, `web/middleware.ts`, `web/lib/env.ts`, `worker/src/env.ts`, `.gitignore`, ambos `.env.example`, `supabase/config.toml`, todo `web/app/api/` + los 4 route handlers, `web/lib/security/*`, `supabase-service.ts`, `payments/index.ts`, `worker/src/index.ts`. Regresiones 0021: `legal.ts`, `mask-email.ts`, páginas legales, `checkout/success`, `checkout-action.ts`, migración `…033`, `signup-disabled.test.ts`. **Búsqueda de secretos ejecutada** con Bash sobre el árbol (`git grep`) y el **historial completo** (`git log --all -p -G`): patrones `onvo_live_/onvo_test_`, `sk_live_/sk_test_`, `re_`, JWTs `eyJ…`, `service_role`. JWT hallados decodificados.

#### Checklist de configuración

| Ítem                                             | Estado                                         | Evidencia / nota                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secretos fuera del repo                          | ✓                                              | Árbol e historial limpios. `git check-ignore` confirma `.env`/`.env.local` ignorados. `git ls-files` solo lista `*.env.example`. Únicos "secretos": JWT `iss:supabase-demo` (públicos del stack local, solo en tests) y placeholders en `.env.example`.                                                  |
| Separación NEXT_PUBLIC vs server-only            | ✓                                              | Exactamente 4 vars `NEXT_PUBLIC_*`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (RLS), `ONVOPAY_PUBLIC_KEY` (publishable), `SENTRY_DSN`. Secretos solo en módulos server. Ninguno en `'use client'`.                                                                                                             |
| Validación de env con Zod                        | ✓                                              | `web/lib/env.ts` y `worker/src/env.ts` con `safeParse` al import; worker `superRefine`. Sin cambios.                                                                                                                                                                                                     |
| CSP                                              | parcial                                        | `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. `'unsafe-eval'` solo en dev. `'unsafe-inline'` persiste (hidratación Next 15/React 19).                                                                                                    |
| HSTS                                             | ✓                                              | `max-age=63072000; includeSubDomains; preload`.                                                                                                                                                                                                                                                          |
| X-Frame-Options / frame-ancestors                | ✓                                              | `DENY` + `frame-ancestors 'none'`.                                                                                                                                                                                                                                                                       |
| X-Content-Type-Options                           | ✓                                              | `nosniff`.                                                                                                                                                                                                                                                                                               |
| Referrer-Policy                                  | ✓                                              | `strict-origin-when-cross-origin`.                                                                                                                                                                                                                                                                       |
| Permissions-Policy                               | ✓                                              | `camera=(), microphone=(), geolocation=(), browsing-topics=()`. Aplicado a `/:path*`.                                                                                                                                                                                                                    |
| CORS no permisivo                                | ✓                                              | Cero `Access-Control-Allow-Origin`; API same-origin.                                                                                                                                                                                                                                                     |
| Rate limiting                                    | parcial                                        | Login, forgot-password, checkout a nivel app (store Postgres atómico). Magic link/OTP por límites nativos de Supabase Auth. Búsqueda pública sin límite propio (INFRA-05).                                                                                                                               |
| HTTPS forzado                                    | requiere dashboard                             | Redirect y certificado los maneja Vercel; HSTS preparado en código.                                                                                                                                                                                                                                      |
| Sin endpoints de debug                           | ✓                                              | Solo 2 rutas `api/` + 4 route handlers (2 export con `requireAnyRole`→401). 0021 NO agregó endpoints. Worker sin puerto HTTP.                                                                                                                                                                            |
| **P1-2: `enable_signup=false` en `config.toml`** | ✓ (código) / **requiere dashboard** (efectivo) | `config.toml:176` `enable_signup=false` **sigue en el repo**. Hook `[auth.hook.custom_access_token] enabled=true`. `[auth.email].enable_signup=true` es intencional (el switch global bloquea). Test `signup-disabled.test.ts` existe. **Verificación efectiva en dashboard = ítem manual obligatorio.** |

#### Hallazgos críticos

Ninguno. Sin secretos hardcodeados ni en el historial (ningún `.env` real jamás commiteado; todo JWT del historial es `iss:supabase-demo`).

#### Hallazgos medios

- **INFRA-01 | `supabase/config.toml` (dashboard hosted) | (→ P1-2, bloqueante por verificación de dashboard).** Flag y hook correctos y versionados; cubiertos por test. Pero `config.toml` no aplica al hosted salvo `supabase config push`, y el estado real solo se confirma en el dashboard. Riesgo: si el hosted tuviera signup habilitado, reabre el vector PII-guías. **No se cierra solo con código.**
- **INFRA-02 | `supabase/config.toml:182,185` | Password policy débil. (→ P2.)** `minimum_password_length=6`, `password_requirements=""` — sin cambios. Mitigación: ≥8 con `lower_upper_letters_digits` (viaja por `config push`) + confirmar en dashboard.

#### Hallazgos bajos

- **INFRA-03 | `supabase-service.ts`, `supabase-server.ts`, `payments/index.ts`, `payments/adapters/onvopay.ts`, `invite-set-token.ts` | Falta `import 'server-only'`. (→ P3.)** Sin cambios. Riesgo bajo (Next solo inlinea `NEXT_PUBLIC_*`).
- **INFRA-04 | `web/lib/security/client-ip.ts` | Confianza en `x-forwarded-for[0]`. (→ P3.)** No-spoofeable solo detrás de Vercel (target confirmado). Aceptable.
- **INFRA-05 | `web/lib/booking/availability.ts` | Búsqueda pública sin rate-limit propio. (→ P3.)** Sin cambios. Reads idempotentes; el checkout sí está limitado.

#### Regresiones del spec 0021 (revisión específica)

Sin hallazgos nuevos. `legal.ts` solo exporta `PRIVACY_NOTICE_VERSION`; `mask-email.ts` función pura; migración `…033` aditiva nullable; `checkout/success` ya no selecciona `customer_name`; `checkout-action.ts` exige consent server-side sin env nueva (su `console.error(…, err)` es PRIV-06, no fuga de secreto); páginas legales estáticas sin service client ni endpoint de mutación.

#### Requiere acceso a dashboards (no verificable desde el repo)

Cubierto en [`GUIA-VERIFICACION-MANUAL.md §1`](GUIA-VERIFICACION-MANUAL.md):

- **Supabase (hosted)** — **P1-2 (bloqueante)**: `enable_signup=false` efectivo + hook activo tras `supabase config push`; password policy ≥8 (INFRA-02); expiración JWT; RLS real por tabla; Storage buckets; pooling; cifrado en reposo.
- **Vercel**: env scopeadas por ambiente; protección de previews; redirect HTTP→HTTPS y certificado; logs sin secretos/PII.
- **Railway (worker)**: env sin filtrarse en logs; sin puertos públicos.
- **OnvoPay**: `ONVOPAY_WEBHOOK_SECRET` coincidente; URL correcta; llaves `onvo_live_` solo en prod; KYC activa.
- **Resend**: dominio verificado; SPF/DKIM/DMARC; API key con permisos mínimos.

#### Referencias cruzadas

- **ACCESS**: P1-2/INFRA-01 comparte verificación de dashboard; password policy débil cruza con ACCESS; middleware sin rol (ACCESS-02).
- **PRIV**: `console.error(…, err)` (PRIV-06) y la suficiencia del email enmascarado son de privacidad. Rate-limit hashea la identidad (SHA-256).
- **PAYSEC**: webhook valida `x-webhook-secret` en tiempo constante; gestión/rotación de `ONVOPAY_*`.
- **APPSEC**: CSP con `'unsafe-inline'`; robustez de redirect/CSRF.

---

_Reporte generado por el Security Council de booking-platform (re-auditoría 1). El council audita; las correcciones las decide y ejecuta el usuario. Para todo lo que requiere dashboards, sistema corriendo o pentesting, ver [`GUIA-VERIFICACION-MANUAL.md`](GUIA-VERIFICACION-MANUAL.md)._
