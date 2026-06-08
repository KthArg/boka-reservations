# Changelog — 0011 Cancelaciones con refund automático

Spec: [0011-cancelaciones-refund-automatico.md](./0011-cancelaciones-refund-automatico.md)
Rama: feat/0011-cancelaciones-refund-automatico

## 2026-06-02 14:45 — Implementación completa, lista para PR

**Hecho**:

- **DB** (`20260602000018`): tablas `refunds`, `audit_logs`, `booking_access_tokens` + función atómica `cancel_booking` (libera cupo, cancela recordatorio, encola email y refund en una transacción). Extendió `notifications.kind`.
- **shared**: `policies.computeRefund` (regla 24h aislada y testeada), `RefundStatus`, `AuditAction/ActorType`, `CancellationError/RefundRetryError`, 2 `NotificationKind`.
- **Token de acceso a la reserva** hasheado (`hashBookingToken`/`validateBookingToken`), espejo del de guías. Resuelve el 404 del link "ver mi reserva" de los emails.
- **Motor** `lib/booking/cancel.ts` (`getBookingView` + `cancelBooking`) + `lib/audit/log.ts`. Server Actions: `cancelByToken` (turista), `cancelByStaff`, `retryRefund`.
- **Worker**: cliente de refunds OnvoPay (`refunds/onvopay.ts`), job `process-refunds` (polling: pending→POST→processing→poll GET→succeeded/failed), templates `cancellation-confirmation` y `refund-confirmation` ES/EN, emisión de token + link `/booking/[token]`.
- **UI**: páginas públicas `/booking/[token]` (ver) y `/booking/[token]/cancel` (con "tenés derecho a reembolso: SÍ/NO"). Panel: botón cancelar + estado del refund + retry manual. i18n `cancellation` + claves de refund (ES/EN).

**Por qué / decisiones**:

- **Refund client en el worker, no en el `PaymentProvider` de web** (corrección del diseño durante implementación, ver spec §5). El reembolso lo dispara el job; el worker es self-contained y ya tiene `ONVOPAY_SECRET_KEY`. Web nunca llama a OnvoPay para reembolsar.
- **OnvoPay refunds sin webhook** (vetting): el resultado se obtiene por polling de `GET /v1/refunds/:id`, no por callback.
- **`p_actor_id` reordenado a último con `DEFAULT NULL`** para que el tipo generado lo marque opcional (turista/sistema sin actor).
- **`web/types/database.ts`**: el CLI 2.101 ensancha columnas con CHECK a `string`; se restauró el archivo de `dev` y se agregaron las entidades nuevas en estilo union para no regresionar el contrato de tipos del resto del repo.

**Pendiente**:

- Nada — feature lista para PR. Política de reembolso definitiva del cliente y trato de comisión de OnvoPay quedan como preguntas abiertas del spec (no bloquean; binaria 24h parametrizable mientras tanto).

**Notas para retomar**:

- Tests: web unit 83, web integ 94, worker unit 45, worker integ 5 — todo verde (suite corrida 2026-06-02). El worker debe estar corriendo para que los refunds avancen (polling 60s), igual que los emails.

## 2026-06-05 — Validación en vivo (navegador + OnvoPay sandbox real) y fix

Probado end-to-end en navegador contra el **sandbox real de OnvoPay** (tarjeta `4242…`, webhook vía ngrok confirmando la reserva). Los tres caminos del refund quedaron validados:

1. **Refund exitoso (turista vía link del email)**: reserva real → cancelación por el token de `/booking/[token]` → worker `POST /v1/refunds` real → `external_refund_id` real → polling a `succeeded` → `booking/payment → refunded`, email `refund_confirmation` enviado, refund visible en el dashboard OnvoPay. Auditoría: `booking.cancelled (tourist)`, `refund.requested`, `refund.succeeded`.
2. **Refund fallido + retry (pago ficticio)**: con un `paymentIntentId` inexistente, OnvoPay responde `404 payment_intents.not_found`; el worker reintenta hasta `MAX_CREATE_ATTEMPTS` (3) y marca el refund `failed`; el panel muestra "Falló" + botón "Reintentar". Camino de error confirmado.
3. **Cancelación por staff con refund exitoso (panel)**: idéntico al 1 pero `actor_type=staff`.

**Bug hallado y corregido (fix `182306e`)**: la tabla `refunds` no tenía política RLS de lectura → el detalle del panel (que lee con la sesión del admin, no `service_role`) no veía la fila y la sección "Refund" nunca aparecía. Se agregó `refunds_select_admin_staff` (mismo patrón InitPlan que `payments`/`bookings`/`notifications`). **Los tests de integración no lo detectaban** porque leen vía `service_role`, que ignora RLS — gotcha guardado en memoria del proyecto.

**Edge case observado (no es bug, decisión de producto)**: si el turista cancela dentro del ciclo de ~60s antes de que el worker despache la confirmación, el `booking_confirmation` se **cancela** en vez de enviarse (guard del 0007: solo se manda si la reserva sigue `confirmed`). El cliente recibe solo el email de cancelación. Defendible (ya vio la confirmación en pantalla al pagar). Si se quisiera siempre enviar la confirmación, se cambiaría el guard.

## 2026-06-06 — Hardening del job de refunds (Checkpoint 6, rama `fix/0011-concurrencia-atomicidad-refunds`)

Re-corrida del Checkpoint 6 con subagentes especializados (payment-flow, db-schema, code-review, performance) sobre el 0011 ya mergeado. Encontró tres problemas reales en el flujo de dinero que la primera revisión no cazó (latentes al volumen actual, pero son plata real y el spec los daba por resueltos). Corregidos en este fix:

**1. Doble POST a OnvoPay por ciclos solapados (doble reembolso).** El spec §5/§8 exigía reclamar la fila con `UPDATE ... WHERE status='pending'` row-locked **antes** del POST (single-flight), pero la implementación posteaba primero y marcaba `processing` después. Como `setInterval` (`index.ts`) no serializa ciclos y los `fetch` no tenían timeout, un ciclo lento permitía que dos invocaciones leyeran la misma fila `pending` y ambas postearan.

- **Fix**: `claimForProcessing` (repository) hace el `UPDATE` condicional atómico y devuelve si ganó el claim; `createRefund` no llama a OnvoPay si no reclamó. Ante fallo transitorio del POST, `releaseClaim` devuelve la fila a `pending` para reintentar. Se agregó `AbortSignal.timeout(15s)` a ambos `fetch` de `onvopay.ts` para que una conexión colgada no apile ciclos.

**2. Refund colgado en `processing` para siempre.** El polling no tenía salida a `failed` si OnvoPay dejaba el refund en `pending` indefinidamente (ni para una fila reclamada que quedó sin `external_refund_id` por un crash). Quedaba fuera del alcance del retry manual (que solo agarra `failed`) → reserva en limbo.

- **Fix**: guard de antigüedad `MAX_PROCESSING_AGE_MS` (24h): un refund `processing` más viejo que eso pasa a `failed` (`processing-timeout` si seguía pending en OnvoPay; `processing-stale` si era un claim huérfano sin `external_refund_id`), habilitando el retry manual.

**3. Cierre del refund exitoso no atómico.** `markSucceeded` hacía 3 UPDATEs (refunds/payments/bookings) + insert de notificación + audit como round-trips sueltos; un crash a mitad dejaba `refund=succeeded` con `booking` aún `cancelled`, irreconciliable (el job ya no reprocesa `succeeded`).

- **Fix**: nueva función DB **`settle_refund`** (`20260606000019`, espejo atómico de `cancel_booking`, `SECURITY DEFINER` con `SET search_path=''`): marca refund/payment/booking, encola el email y audita en una sola transacción. `markSucceeded` ahora solo invoca el RPC. El audit `refund.succeeded` ahora incluye `currency` y `external_refund_id` para reconciliar sin cruzar tablas.

**Falso positivo descartado** (verificado a mano): los subagentes marcaron como crítico que la URL de OnvoPay (`api.onvopay.com/v1`) apunta a producción con llave de test. Es **idéntica al adapter de pagos del 0006** que se validó en sandbox, y el 0011 también se validó contra el sandbox real con esa misma base → no es regresión ni bug. Queda una discrepancia doc↔realidad (el skill `codebase-conventions` menciona `api.dev.onvopay.com`) a reconciliar por separado.

**Segunda pasada — también se corrigieron los hallazgos medios/menores** (a pedido: no solo los críticos):

**4. `search_path` faltante en `confirm_booking`/`cancel_booking`** (SECURITY DEFINER). Contradecían el hardening que el proyecto ya aplicó en `20260523000008`. Se redefinen ambas con `SET search_path = ''` (ya calificaban todo con `public.`). **Gotcha**: `confirm_booking` había sido redefinida en `20260530000013` para encolar la confirmación + recordatorio 24h; la primera versión del fix la regeneró desde la definición original (sin esa lógica) y rompió dos tests de `send-notifications` — corregido tomando el cuerpo vigente. (Lección: al hacer `CREATE OR REPLACE`, partir de la última definición, no de la que crea la tabla.)

**5. Monto del refund = lo efectivamente pagado.** `cancel_booking` insertaba el refund con `bookings.total_amount_cents`; ahora usa `payments.amount_cents`/`payments.currency` del pago exitoso. `p_refund_amount_cents` solo decide elegibilidad (>0). Test nuevo con total≠pago.

**6. Token del email de cancelación con TTL propio.** El link "ver mi reserva" del email de cancelación expiraba en `starts_at` (nacía muerto si el tour ya pasó). `bookingViewUrl` ahora acepta `expiresAtIso`; cancelación pasa 30 días. Confirmación/recordatorio siguen expirando en `starts_at`. Test nuevo en `send-notifications`.

**8. `audit_logs` realmente append-only.** Migración `20260606000021`: trigger `BEFORE UPDATE OR DELETE` que rechaza la mutación (inmutable incluso para `service_role`). Se quitaron los `audit_logs.delete()` de los teardowns de los tests (la tabla ya no se puede vaciar; los asserts son por `entity_id` fresco). Test nuevo de inmutabilidad.

**10. Lint `no-restricted-syntax` en `onvopay.ts`.** `mapStatus` comparaba contra el literal `'failed'`; se reescribió como lookup de mapa. Worker lint queda 0 errores (solo warnings `no-magic-numbers` de aritmética de tiempo, patrón ya tolerado en el repo).

**Sigue fuera de alcance** (deuda anotada): `markFailed` del poll no incrementa `attempts` (es correcto-por-diseño: un fallo de polling no es un intento de creación); discrepancia doc↔realidad de la URL de OnvoPay (`api.dev.onvopay.com` en el skill vs `api.onvopay.com` en el código que funciona).

**Hecho**:

- Migraciones: `20260606000019_settle_refund_atomic.sql` (`settle_refund`), `20260606000020_harden_booking_functions.sql` (search_path + refund por monto pagado), `20260606000021_audit_logs_append_only.sql` (trigger de inmutabilidad).
- `worker/src/refunds/repository.ts`: `claimForProcessing`, `releaseClaim`, `markSucceeded` vía RPC, `RefundRow.created_at`; se eliminó `bumpAttempts`.
- `worker/src/jobs/process-refunds.ts`: claim antes del POST, guard de antigüedad, manejo de claim huérfano.
- `worker/src/refunds/onvopay.ts`: timeout en los `fetch` + `mapStatus` como lookup.
- `worker/src/notifications/prepare.ts` + `prepare-cancellation.ts`: TTL propio del token de cancelación.

**Tests** (corridos 2026-06-06 con `db reset` + cadena completa de migraciones, todo verde): worker unit **48** (+3: single-flight, processing-timeout, claim huérfano), worker integ **7** (+2: claim concurrente real, TTL del token de cancelación), web unit **83**, web integ **96** (+2: refund por monto pagado, inmutabilidad de audit_logs). Typecheck limpio, lint 0 errores.
