# 0028 — Cierre de hallazgos del code review integral pre-cutover

- **Estado**: approved
- **Autor**: Claude Code (con Kenneth)
- **Creado**: 2026-07-06
- **Última actualización**: 2026-07-06
- **Rama**: tres ramas secuenciales — `fix/0028-dinero`, `fix/0028-panel-portal`, `chore/0028-deuda-menor-ci` (ver §11)
- **PR**: pendiente (un PR por rama)

## 1. Contexto y motivación

El 2026-07-06 se ejecutó un code review integral de todo el proyecto en `dev` (5 subagentes en paralelo: code-reviewer ×3, db-schema-guardian, payment-flow-auditor), previo a la promoción `dev → main` y al cutover a producción. Lint, typecheck y unit tests están en verde, pero el review encontró **2 hallazgos críticos, 6 altos, ~20 medios y ~13 bajos**, concentrados en la ruta del dinero y en bugs operativos del panel.

Los dos críticos comparten el mismo modo de fallo — **dinero cobrado sin reserva, sin refund y sin alerta** — que es exactamente la clase de error que no puede existir al operar con turistas reales. Este spec agrupa el cierre de todos los hallazgos corregibles por código, siguiendo el precedente de las rondas de hardening (specs 0016–0026): un spec por ronda, con hallazgos identificados y verificados contra el código.

Los hallazgos que requieren verificación manual contra el sandbox de OnvoPay (no código) quedan en §13 y en el checklist pre-producción.

## 2. Objetivos

- Eliminar todos los caminos identificados por los que un cobro real puede terminar sin reserva confirmada, sin refund automático y sin alerta.
- Garantizar que un refund no pueda ejecutarse dos veces por la combinación de reintentos automáticos y reintentos manuales.
- Corregir los bugs operativos que el operador sufriría el día uno (loop de redirects, día UTC en filtros/export contable, precios que fallan al guardarse en silencio).
- Endurecer el worker (timeouts, solapamiento, poison pill, backoff, env de producción) y el pipeline de CI (tests de integración).
- Cerrar la deuda menor de convenciones detectada (strings mágicos, i18n, índices, constraints).

## 3. Fuera de alcance

- **Las verificaciones manuales contra el sandbox de OnvoPay** (¿un intent viejo sigue pagable?, ¿OnvoPay capa refunds al monto cobrado?, ¿qué reporta el webhook para SINPE?, ¿reintenta ante 4xx?). Son ítems del checklist pre-producción; este spec agrega las defensas de código que funcionan sea cual sea la respuesta.
- **Soporte real de SINPE Móvil / CRC en el checkout.** El checkout sigue operando en USD. Si la verificación en sandbox muestra que SINPE produce mismatch, la decisión de producto (deshabilitar SINPE en el widget o soportar CRC) es un spec futuro. Este spec solo garantiza que un mismatch ya no filtre cupo para siempre.
- **Cambios a la política de refund** (sigue binaria 24h). La pregunta abierta con el cliente no se toca.
- **Reportes multi-moneda.** Solo se agrega el CHECK defensivo de `currency`; la agregación por moneda queda para cuando exista una segunda moneda real.
- **Texto legal, PRODHAB, cuentas de servicios** (responsabilidad del cliente / cutover).
- **El segundo proveedor de pagos (PayPal).** Las limitaciones de la interfaz `PaymentProvider` documentadas por el review se resuelven en el spec de esa integración.

## 4. Historias de usuario

> Como turista que pagó (aunque haya pagado tarde o con un fallo transitorio de por medio), quiero que mi dinero siempre termine en una reserva confirmada o en un reembolso automático, para no quedar cobrado y sin tour sin que nadie se entere.

- [ ] Si el INSERT del pago falla durante el checkout, el turista ve un error y **no puede pagar** un intent huérfano (el intent se cancela best-effort y nunca se le entrega al widget).
- [ ] Si un pago llega por webhook para una reserva **`cancelled`** (p. ej. cancelada por staleness), el sistema encola un **refund total automático**, lo audita y alerta a Sentry; para estados ya resueltos (`confirmed`/`refunded`/`overbooked_refunded`) responde idempotente, y para `payment_mismatch` alerta sin tocar nada. Reenvíos del mismo evento → `already_processed` (no duplican refund, audit ni alerta).
- [ ] El webhook ya no puede confirmar con asientos incorrectos: `confirm_booking` deriva los asientos de la propia reserva y la lectura previa de `bookings` en el handler desaparece. Si la lectura de `payments` falla por error de query, el handler responde 500 (OnvoPay reintenta) en vez de tratarla como "no existe".
- [ ] Un refund con `external_refund_id` conocido nunca se re-crea: el retry (manual o automático) **verifica** el refund existente en OnvoPay y asienta su estado.

> Como operador, quiero que el panel refleje mi día real (Costa Rica) y que mis cambios de precio se guarden de verdad o me avisen, para no cobrar precios viejos ni descuadrar la contabilidad.

- [ ] Editar precios/horarios de un tour guarda todo o muestra error; quitar un precio del formulario lo elimina de la DB; dos precios **con fechas** del mismo tipo no pueden solaparse (la DB lo rechaza); un precio base (sin fechas) convive con temporadas y **la temporada siempre gana** cuando la fecha cae dentro de su ventana (regla determinista, hoy el monto era azaroso).
- [ ] Los filtros del listado de reservas y el export CSV usan el día de `America/Costa_Rica`; un tour de las 19:00 CR aparece en el día CR correcto.
- [ ] Escribir `midominio.com/dashboard` deslogueado lleva al login (no a `ERR_TOO_MANY_REDIRECTS`).
- [ ] Archivar un tour con reservas activas futuras se bloquea con mensaje claro; sin reservas, sus salidas futuras dejan de ser visibles y reservables.

> Como staff, quiero que la cola de emails y refunds no se atasque por un ítem envenenado ni por una conexión colgada, para que las confirmaciones y reembolsos sigan saliendo solos.

- [ ] Un error persistente en una notificación no bloquea el resto de la cola.
- [ ] Una conexión colgada a Resend no apila ciclos solapados (timeout de 15 s + guard de ejecución).
- [ ] Una caída de Resend de 10 minutos se recupera sola (backoff real 1/5/30).
- [ ] Si al worker le falta `ONVOPAY_SECRET_KEY` o `EMAIL_PROVIDER` en producción, muere al arrancar (no degrada en silencio).

## 5. Diseño técnico

Tres workstreams = tres PRs secuenciales. Cada hallazgo lleva su fix mínimo; no se rediseña nada que funcione.

### Workstream A — ruta del dinero (`fix/0028-dinero`)

**A1. Checkout a prueba de fallos parciales** (`web/lib/booking/create.ts`). Reordenar y chequear TODAS las escrituras: crear intent → insertar `payments` verificando `error` (si falla: cancelar el intent best-effort, **liberar el hold de inmediato** — el camino de fallo existente en el catch ya hace `releaseHold`, se conserva — y abortar el checkout con error genérico) → recién entonces transicionar el hold a `paying` (verificando `error`). Invariante resultante: **el widget nunca recibe un `paymentIntentId` que no esté persistido en `payments`**.

**A2. `confirm_booking` con outcome y asientos autoritativos** (migración `20260706000040`). La función pasa de `RETURNS void` a `RETURNS text` con outcome explícito. Cambios internos:

- **La idempotencia por evento pasa a gatear** (hoy el INSERT en `processed_webhook_events` con `ON CONFLICT DO NOTHING` es solo registro y nunca corta la ejecución; la idempotencia real es solo por estado, insuficiente para el camino late). Nuevo orden: si `p_event_id` no es NULL, el INSERT verifica filas insertadas; **0 filas → `RETURN 'already_processed'`** sin tocar nada. Caveat documentado: el reconciliador llama sin `p_event_id`, así que en ese caller la defensa del camino late es el índice único de refund activo.
- **Mapping exacto estado → outcome** (después del gate por evento, con la reserva bajo `FOR UPDATE`):
  - `pending_payment` → camino actual: `confirmed` | `overbooked_refunded` | `payment_mismatch`.
  - `cancelled` → **camino nuevo `late_payment_refunded`**, con **guard de elegibilidad** _(agregado en review pre-PR por el db-schema-guardian)_: solo califica un pago que estaba `pending` o `failed` (nunca cobrado/gestionado). Un pago ya `succeeded` pertenece a una reserva confirmada y cancelada por la vía normal — reembolsarlo violaría la política (<24h sin refund) o duplicaría un refund `failed` — → `ignored`. Si califica: marca el pago `succeeded` (espejo del camino overbooked), encola refund total en la misma transacción (INSERT en `refunds` respetando el índice único parcial; si ya existe uno activo, no duplica y el audit registra `refund_enqueued: false`) + audit `booking.late_payment_refunded`. La reserva NO cambia de estado aquí; cuando el refund se acredite, `settle_refund` la lleva a `refunded` (semántica existente de 0011 — ver §7).
  - `confirmed`, `refunded`, `overbooked_refunded` → `already_processed` (reserva ya resuelta; nada que hacer).
  - `payment_mismatch` → `ignored` (hay una resolución manual pendiente; el webhook alerta a Sentry).
- **Deriva `v_total_seats` de la propia reserva** (`tickets_adult + tickets_child + tickets_student`); `p_total_seats` queda deprecated (se acepta y se ignora, para compatibilidad con callers desplegados; se elimina en una migración futura).
- **El camino feliz escribe en `audit_logs`** (`booking.confirmed`), cerrando el hueco forense.
- **El camino `payment_mismatch` libera el hold `paying`** (→ `released`), igual que se corrige en `flag_payment_mismatch`. El cupo no está confirmado en mismatch; retenerlo indefinidamente solo bloquea ventas.
- Cambiar el tipo de retorno exige `DROP FUNCTION` + `CREATE`: la migración **re-aplica los REVOKE/GRANT y el guard `is_public_request`** de los specs 0018/0019 (las funciones de auditoría de regresión existentes lo verifican).
- Compatibilidad de despliegue: `void → text` es backward-compatible (ambos callers actuales destructuran solo `error`), así que la migración puede aplicarse antes que el deploy de web/worker.
- **`web/types/database.ts` se edita A MANO** (gotcha documentado: `pnpm db:types` destruye la curación): `confirm_booking.Returns` pasa de `void` a la unión de outcomes.

**A3. Webhook y reconciliador consumen el outcome** (`web/app/api/webhooks/onvopay/route.ts`, `worker/src/reconciliation/*`).

- **La lectura de `bookings` del handler se elimina** (con A2 su único uso — sumar asientos — desaparece, y con ella el modo de fallo "confirmar con 0 asientos" de raíz).
- La lectura de `payments` usa `maybeSingle()` y distingue **error de query (→ 500, OnvoPay reintenta)** de **fila inexistente (→ 404)**.
- El handler consume el outcome de la RPC: `late_payment_refunded`, `overbooked_refunded` e `ignored` → alerta Sentry con fingerprint propio (se elimina la re-lectura actual del status post-RPC).
- El **reconciliador** (otro caller de la RPC) también consume el outcome en `confirmRecoveredBooking` y alerta según él — reemplaza su re-lectura `fetchBookingStatus` y cubre la race reconciliador↔cancelación-por-staleness (que puede disparar el camino late desde el worker).

**A4. Refunds sin doble ejecución** (`worker/src/refunds/*`, `worker/src/jobs/process-refunds.ts`, `web/lib/refunds/retry-action.ts`).

- **Camino "verify" generalizado**: el worker YA verifica sin re-POSTear las filas `processing` con `external_refund_id` (`pollRefund` usa el `GET /v1/refunds/{id}` vetteado 2026-06-02). Lo nuevo: (a) una fila `pending` **con** `external_refund_id` también entra al verify (hoy re-POSTea — es el camino del doble refund); (b) el retry manual (`retry-action.ts`) de un refund `failed` con `external_refund_id` lo devuelve a `processing` (no a `pending` con `attempts: 0` como hoy), dirigiéndolo al verify; sin `external_refund_id`, retry normal a `pending`.
- **Timeout ambiguo del POST** (AbortError/timeout, respuesta desconocida): el refund pasa a `failed` con razón `ambiguous-timeout` + **alerta Sentry de nivel error** (verificación manual contra el dashboard de OnvoPay antes de reintentar). Nunca re-POST automático tras un resultado desconocido. Los errores claros (4xx/5xx con respuesta) siguen el retry normal.
- **Backoff real 1/5/30** para los reintentos de creación: la selección de candidatos `pending` respeta una espera mínima calculada de `attempts` + `updated_at` (sin columnas nuevas).
- **Chequeo de error en las 8 escrituras del worker** que hoy lo descartan (`markProcessing`, `markSent`, `markFailed`, `releaseClaim`, `handleTransient`, `cancelNotification`, `writeAudit`). Caso especial: si `markProcessing` falla después de un POST exitoso → Sentry crítico con el `external_refund_id` en el mensaje (es el dato que evita el doble refund manual).
- **Graceful shutdown**: handler de SIGTERM/SIGINT en `worker/src/index.ts` que espera el fin del ciclo en curso antes de salir (Railway manda SIGTERM en cada deploy).

**A5. Cola de notifications robusta** (`worker/src/notifications/*`, `worker/src/jobs/send-notifications.ts`).

- **Timeout de 15 s** (`AbortSignal.timeout`) en los adapters de Resend y mailpit (mismo patrón y comentario que los clientes OnvoPay).
- **Guard de solapamiento** (`isRunning`) en `sendNotifications` y `processRefunds` (copiando el de `reconcilePendingPayments`).
- **Aislamiento por ítem** (poison pill): try/catch por notificación dentro del batch; un throw inesperado registra el fallo como transitorio de ESA notificación (attempts + reprogramación) y el batch continúa.
- **Off-by-one del backoff**: se corrige para que la política real sea 3 reintentos (1 min, 5 min, 30 min) y `failed` recién al cuarto intento, como documenta la convención. El unit test que hoy fija el comportamiento erróneo se actualiza citando esta corrección.

**A6. Env del worker endurecida** (`worker/src/env.ts`). En `NODE_ENV=production` el schema exige `ONVOPAY_SECRET_KEY` presente y `EMAIL_PROVIDER=resend` (proceso muere al arrancar si falta). Nueva variable `ONVOPAY_API_BASE_URL` (default `https://api.onvopay.com/v1`) consumida por los dos clientes del worker **y** por el adapter de web — desbloquea probar el circuito completo contra `https://api.dev.onvopay.com`. Documentada en ambos `.env.example`.

**A7. `shared/` sincronizado con la realidad**: `NotificationKind` gana `overbooked_refunded`; `AuditAction` gana `booking.recovered_via_reconcile`, `booking.overbooked_refunded`, `booking.late_payment_refunded`, `booking.confirmed`. (El worker sigue self-contained: sus copias locales se actualizan a la par.)

**A8. Reconciliador — cancelación best-effort del intent** (condicional a §13-P1): si OnvoPay expone cancelación de payment intents, `cancel_stale_pending_booking` va acompañada de un `POST /payment-intents/{id}/cancel` best-effort desde el worker (falla silenciosa tolerada: la capa A2/A3 es la garantía). Si el endpoint no existe, este punto se omite sin afectar el resto.

### Workstream B — panel y portal (`fix/0028-panel-portal`)

**B1. `updateTour` confiable y semántica de precios determinista** (`web/lib/tours/actions.ts`, `web/lib/tours/validation.ts`, `web/lib/pricing/active-filter.ts`, `web/lib/booking/pricing-math.ts`). Toda escritura verifica `error` y aborta con código de error (nada de redirect tras fallo silencioso). El guardado reconcilia el estado final: filas quitadas del formulario se eliminan, las presentes se upsertean, y la validación de solapes corre contra el **estado final** (enviado ∪ persistente), con el borde inclusivo corregido (rangos `[from, until]` cerrados en ambos extremos, consistente con el filtro de vigencia).

**Decisión de semántica de precios** (hoy el código la deja ambigua y el monto cobrado es azaroso cuando coexisten): se CONSERVA el modelo actual del formulario — un **precio base** (sin fechas) por `(tour, ticket_type)` que convive con **temporadas** (con fechas) — y se vuelve determinista: **la temporada gana sobre el base** cuando la fecha cae en su ventana. La regla de prioridad se implementa en un único punto (`active-filter`/`pricing-math`: elegir la fila con fechas por sobre la fila base; nunca `Map` con orden azaroso). Reglas de integridad resultantes: máximo un precio base activo por `(tour, ticket_type)`; las temporadas activas del mismo `(tour, ticket_type)` no pueden solaparse entre sí (bordes inclusivos). Display y cobro comparten el filtro, así que lo mostrado = lo cobrado.

Los ~7 mensajes de error en español se reemplazan por códigos + claves i18n ES/EN (mismo patrón que `users/*`). `archiveTour`/`reactivateTour` también chequean error.

**B2. Constraints e índices** (migración `20260706000041`):

- `EXCLUDE` con `btree_gist` en `tour_pricing` **solo entre filas con fechas**: prohíbe dos filas activas del mismo `(tour_id, ticket_type)` con ventanas `daterange(valid_from, valid_until, '[]')` solapadas, restringido a filas con al menos un límite (`WHERE active AND (valid_from IS NOT NULL OR valid_until IS NOT NULL)`; un límite NULL dentro del rango = infinito hacia ese lado). El precio base queda fuera del EXCLUDE y se protege con un **UNIQUE parcial**: una sola fila base activa por `(tour_id, ticket_type)` (`WHERE active AND valid_from IS NULL AND valid_until IS NULL`). Garantía en DB de la semántica de B1 (base + temporadas sin solape entre temporadas).
- `CHECK currency IN ('USD','CRC')` en `bookings`, `payments`, `refunds`.
- `UNIQUE (tour_instance_id)` en `tour_instance_guides` — regla MVP "un guía por salida" en DB.
- Índices de soporte para las 6 FKs sin índice + índice funcional `lower(customer_email)` en `bookings` (lo usa la anonimización).
- La DB de prod aún no tiene datos: no se requieren `NOT VALID`/`CONCURRENTLY`.

**B3. Middleware sin loop** (`web/middleware.ts`). El guard de rutas protegidas reconoce si el primer segmento es un locale válido (`es`/`en`); si no lo es, delega primero en next-intl (redirect a `/{defaultLocale}{pathname}`) y el guard corre sobre la URL ya localizada. Se agregan tests del camino (`/dashboard` deslogueado → login localizado con su `redirectTo`).

**B4. Un solo "día del negocio"** (`web/lib/booking/repository.ts`, `web/lib/booking/admin-filters.ts`, `web/lib/pricing/active-filter.ts`). Los filtros del listado admin y el export CSV calculan los límites del día en `America/Costa_Rica` reutilizando el helper de `reports/range.ts` (single source). `pricingToday()` evalúa la fecha en CR. Semántica documentada en el código: "día = día calendario de Costa Rica".

**B5. Success page honesta** (`checkout/success/page.tsx`). Usa el `status` que ya consulta: `confirmed` → confirmación actual; `pending_payment` → "estamos procesando tu pago, te llega un email al confirmarse" (claves i18n nuevas); cualquier otro estado → mensaje neutro con referencia al email. Sin PII adicional.

**B6. Liberación de hold fuera del render** (`checkout/cancel/page.tsx` → `web/lib/booking/release-hold.ts`). La lógica se extrae a `lib/` con chequeo de error y constantes de estado; la page delega. El side-effect en GET se mantiene (el widget redirige por GET) — tradeoff documentado, mitigado por cookie de sesión + idempotencia del update condicional.

**B7. El portal no ofrece pasado** (`web/lib/public/tours.ts`, `web/lib/booking/checkout-action.ts`). `getUpcomingInstances` filtra `starts_at >= now()`. `checkout-action` mapea `HOLD_INSTANCE_PAST` a un error i18n específico ("esta salida ya ocurrió") en vez del genérico.

**B8. Filtros validados** (`web/lib/booking/admin-filters.ts`). `dateFrom`/`dateTo` deben ser `YYYY-MM-DD` válidos y `tourId` un UUID; valores inválidos se ignoran (sin filtro) en el listado, y `validateExportRange` rechaza además rango invertido (`from > to`).

**B9. Asignación de guía atómica** (`web/lib/guides/assign-action.ts`). Con el UNIQUE de B2, el reemplazo pasa a un único upsert `ON CONFLICT (tour_instance_id) DO UPDATE` (adiós delete+insert). El encolado del email de asignación queda idempotente por el unique existente de notifications.

**B10. Rate limiting en magic links** (`web/lib/booking/access-token.ts`, `web/lib/guides/token.ts`). La validación de token de turista y de guía pasa por `check_rate_limit` (mismo store Postgres), con límites nuevos en `shared/constants/rate-limit.ts` (p. ej. 20 intentos/hora por IP). Excedido → misma respuesta que token inválido (sin oráculo).

**B11. Env de web validada al boot** (`web/lib/env.ts`, `web/instrumentation.ts`, clientes de `web/lib/db/`). El schema se divide en server-required real (sin `RESEND_API_KEY`, que el web no usa — los emails van por cola) y público (`NEXT_PUBLIC_*`). `instrumentation.ts` importa `env` para que un deploy con env incompleta falle al arrancar. Los clientes Supabase y el adapter de pagos consumen `env` tipada en vez de `process.env.X!`.

**B12. Archivar tour con salidas coherentes** (`web/lib/tours/actions.ts`). Si el tour tiene instancias futuras con reservas activas (`pending_payment`/`confirmed`) → se bloquea el archivado con error explicativo. Sin reservas activas → sus instancias futuras `available` pasan a `cancelled` en la misma operación. (Con B7, las pasadas dejan de listarse solas.)

**B13. Detalles i18n/UX**: los 400 de los exports devuelven códigos; `BookingDetailView` traduce `n.status` por diccionario; `reset-password` usa una clave de mensaje de error real.

### Workstream C — deuda menor + CI (`chore/0028-deuda-menor-ci`)

**C1. Cierres SQL menores** (migración `20260707000042`): `cancel_booking` encola `p_refund_amount_cents` (el monto que audita) en lugar de `v_payment.amount_cents` — hoy idénticos, elimina el footgun del refund parcial futuro; guard atómico anti-TOCTOU de "último admin" (la desactivación valida y actualiza en un solo statement/función); se elimina la política `users_delete_admin` (el delete real siempre falla por FKs; la operación soportada es desactivar — se documenta); el job de retención purga `processed_webhook_events` mayores a 90 días (constante nueva en la config de retención).

**C2. Renombrado de ruta**: `/dashboard/bookings/hoy` → `/dashboard/bookings/today` (regla de segmentos en inglés; barato antes del go-live, caro después).

**C3. Strings mágicos**: nueva const `HoldStatus` en `shared/constants/enums.ts`; los ~22 usos literales de estados (`'active'`, `'paying'`, `'released'`, `'available'`, `'adult'`, `'confirmed'`, `'processing'`, `'succeeded'`…) en `web/lib` y `worker/src` pasan a constantes (el worker con sus copias locales); `HOLD_SESSION_COOKIE` deduplicada a `shared/constants`. Si el árbol queda limpio, las reglas `no-magic-numbers`/`no-restricted-syntax` del worker suben de `warn` a `error`.

**C4. `CheckoutForm` tipado**: interfaz mínima del SDK de OnvoPay (adiós los 4 `any` + eslint-disable), `ONVO_SDK_URL` y `paymentType` a `shared/constants/`; cleanup del `<script>` inyectado.

**C5. Timestamps comparados numéricamente**: `availability.ts` y `guide-view.ts` comparan con `getTime()` (no strings de formatos distintos).

**C6. `tour_schedules.valid_from/valid_until` dejan de ser columnas muertas**: el generador de instancias del worker las respeta (no genera salidas fuera de la ventana de vigencia del horario).

**C7. `shared/index.ts` re-exporta todos los módulos de constantes (15 al cierre) + types + schemas.**

**C8. CI con tests de integración** (`.github/workflows/ci.yml`): job nuevo que levanta Supabase local (`supabase start` + `db reset`), corre `pnpm test:integration` de web y worker, y typecheck de `shared/`. Gate obligatorio del PR (junto al job actual).

## 6. Modelo de datos

Sin tablas ni columnas nuevas. Tres migraciones:

- **`20260706000040_confirm_booking_outcome_late_refund.sql`** — **Función**: `confirm_booking` (DROP + CREATE con `RETURNS text`; **gate por evento**: el INSERT en `processed_webhook_events` verifica filas insertadas y 0 filas → `already_processed`; asientos derivados de la reserva; camino `late_payment_refunded` que marca el pago `succeeded` + INSERT en `refunds` + audit; audit en camino feliz; liberación del hold en mismatch; re-aplica REVOKE/GRANT + guard `is_public_request`). **Función**: `flag_payment_mismatch` (libera hold `paying`). Acompañada de la edición MANUAL de `web/types/database.ts` (Returns: unión de outcomes).
- **`20260706000041_constraints_indices_integridad.sql`** —
  - **`tour_pricing`**: `CREATE EXTENSION IF NOT EXISTS btree_gist`; EXCLUDE anti-solape entre filas con fechas (`WHERE active AND (valid_from IS NOT NULL OR valid_until IS NOT NULL)`); UNIQUE parcial de precio base (`WHERE active AND valid_from IS NULL AND valid_until IS NULL`) por `(tour_id, ticket_type)`.
  - **`bookings`/`payments`/`refunds`**: CHECK `currency IN ('USD','CRC')`.
  - **`tour_instance_guides`**: UNIQUE `(tour_instance_id)`.
  - **Índices**: `bookings(hold_id)`, `bookings(checked_in_by)`, `refunds(payment_id)`, `audit_logs(actor_id)`, `notifications(guide_id)`, `tour_instance_guides(assigned_by)`, funcional `lower(customer_email)` en `bookings`.
- **`20260707000042_cierres_menores.sql`** — `cancel_booking` (monto encolado = monto auditado); función/statement atómico de desactivación de admin (anti-TOCTOU último admin); DROP POLICY `users_delete_admin` **en su versión vigente (la recreada por `20260523000009`)**, documentando "solo desactivación"; retención de `processed_webhook_events` (90 días) en el job de retención.

Reversibilidad: cada migración documenta su down; el DROP de `confirm_booking` se revierte re-creando la versión de `…037`.

## 7. Estados y transiciones

Sin estados nuevos. Transiciones nuevas/corregidas:

- `tour_holds`: `paying → released` ahora también ocurre en `payment_mismatch` (antes: fuga permanente).
- `refunds`: el retry manual de un `failed` **con** `external_refund_id` transiciona a `processing` (camino verify), no a `pending`; `failed` gana la razón `ambiguous-timeout` (requiere verificación manual).
- `bookings`: una reserva `cancelled` que recibe un pago válido no cambia de estado al encolar el refund (el evento queda en audit + `processed_webhook_events`); cuando el refund se acredita, **`settle_refund` la lleva a `refunded`** (semántica existente del spec 0011, que preserva solo `overbooked_refunded`). Terminal esperado: `cancelled → refunded`. El panel ya muestra `refunded`.
- `payments`: en el camino late el pago pasa a `succeeded` al encolar el refund (espejo del camino overbooked) y a `refunded` cuando se acredita — sin pagos "reembolsados que nunca fueron succeeded" descuadrando reportes.

## 8. Casos borde y errores

- **Dos webhooks concurrentes del mismo pago tardío**: el gate por evento (INSERT verificado en `processed_webhook_events`, misma transacción) + índice único de refund activo por reserva → un solo refund, un solo audit. Test de concurrencia.
- **Reenvío posterior del mismo evento late**: outcome `already_processed` (por el gate por evento), sin repetir audit ni alerta.
- **Pago tardío para una reserva `cancelled` que YA tiene refund activo** (no debería: cancelación por staleness no encola refund; pero por robustez): el INSERT choca con el índice único parcial → outcome `late_payment_refunded` no duplica; se audita y alerta igual.
- **INSERT de `payments` falla y la cancelación best-effort del intent también**: el checkout devuelve error igual; el intent huérfano no está en DB pero tampoco se entregó al widget → no cobrable desde nuestra UI. Riesgo residual aceptado y documentado.
- **`markProcessing` falla tras POST exitoso**: Sentry error con el `external_refund_id` en el mensaje; la fila queda `processing` SIN id → el guard stale la lleva a `failed('processing-stale')`. _(Corregido en review pre-PR)_: como el id NO quedó persistido, el retry manual de esa fila queda **bloqueado** (`RequiresManualCheck`) — el staff verifica en OnvoPay con el id de la alerta y resuelve en DB; jamás re-POST a ciegas. Lo mismo aplica a `failed('ambiguous-timeout')` sin id.
- **Timeout ambiguo sin `external_refund_id`**: `failed('ambiguous-timeout')` + Sentry error; el staff verifica en el dashboard de OnvoPay antes de reintentar. Preferimos intervención manual a doble reembolso.
- **Worker muere (SIGTERM) a mitad de ciclo**: shutdown espera el ciclo en curso; si muere duro (SIGKILL), los claims quedan `processing` y el guard stale + camino verify los recuperan sin re-POST.
- **`/dashboard` con locale inválido** (`/fr/dashboard`): next-intl resuelve/404 antes del guard; sin loop.
- **Filtro con `dateFrom` inválido**: se ignora el filtro (listado sin ese criterio), no 500.
- **Archivar tour mientras un turista tiene un hold activo del mismo**: el hold vive su TTL; la instancia pasa a `cancelled` y `create_hold_atomic`/`confirm_booking` ya la rechazan. El turista en checkout recibe error de disponibilidad (existente).
- **Dos admins asignan guía a la vez**: upsert con UNIQUE → gana el último, una sola fila. Sin salidas con dos guías.
- **Rate limit de magic link excedido**: respuesta idéntica a token inválido (sin revelar existencia), con evento en el store de rate limit.
- **Datos preexistentes que violen los constraints de `…041`**: el seed actual pasa tal cual (temporadas adyacentes sin solape y sin duplicado de base); si en algún entorno hubiera datos manuales en conflicto, la migración falla explícitamente al crear el constraint y se limpian antes de reintentar (en prod aún no hay datos).

## 9. Impacto en otras áreas

- **Panel admin**: mensajes de error de tours ahora traducidos (claves i18n nuevas ES/EN); ruta `hoy` → `today` (actualizar links internos); filtros y export cambian semántica de día (UTC → CR) — comunicarlo al operador en el runbook; success/cancel de checkout con textos nuevos.
- **Emails**: sin templates nuevos. El refund de pago tardío entra por el pipeline existente de refunds (notificación de refund ya existente).
- **Worker**: tres jobs tocados (send-notifications, process-refunds, generate-tour-instances) + env nueva `ONVOPAY_API_BASE_URL` + exigencias de env en producción (documentar en Railway).
- **Reportes**: sin cambios de queries; el export CSV cambia el corte de día (contable — avisar al cliente).
- **i18n**: ~15 claves nuevas (errores de tours, success/cancel states, error de salida pasada, export errors).
- **Seguridad**: `confirm_booking` se re-crea — las funciones de auditoría de regresión (0018/0019/0023) deben seguir en verde; el camino `late_payment_refunded` mueve dinero y queda cubierto por el guard `is_public_request` + REVOKE existentes.

## 10. Plan de tests

**Integración (Postgres real, sin mocks de DB):**

- Checkout: INSERT de `payments` forzado a fallar → el checkout aborta, el hold NO queda `paying`, no se devuelve intent.
- Webhook late-payment: booking cancelada por staleness + evento `succeeded` válido → pago marcado `succeeded`, refund total encolado, audit, outcome `late_payment_refunded`; reenvío del mismo evento → `already_processed` sin repetir audit/alerta; dos webhooks concurrentes → un solo refund; al asentarse el refund la reserva termina `refunded`.
- `confirm_booking` deriva asientos: llamada con `p_total_seats` mentiroso (0 y 99) → `capacity_reserved` se incrementa por los tickets reales.
- Mismatch libera hold: `flag_payment_mismatch` y el camino mismatch de la RPC dejan el hold `released`.
- Refunds: retry manual con `external_refund_id` → camino verify (GET, no POST); claim + verify concurrentes → un solo settle; backoff respeta 1/5/30.
- `updateTour`: quitar un precio lo elimina; solape adyacente entre temporadas (borde compartido) rechazado por validación Y por el constraint; segundo precio base activo rechazado por el UNIQUE parcial; upsert fallido → error visible.
- Prioridad de precios: con base + temporada vigentes el mismo día, el checkout cobra SIEMPRE la temporada (y el display muestra lo mismo).
- Asignación de guía concurrente → una fila.
- Rate limit de magic links: excedido → misma respuesta que token inválido.
- Anti-TOCTOU: dos desactivaciones concurrentes de los dos últimos admins → al menos uno queda activo.

**Unit:**

- Webhook handler: error de query en `payments` → 500; fila inexistente → 404 (mock del cliente, patrón existente).
- Middleware: `/dashboard` deslogueado → redirect a login localizado (con su `redirectTo`), sin loop; `/es/dashboard` protegido intacto.
- Día CR: bordes 17:59/18:00/23:59 CR en filtros de listado, export y `pricingToday()`.
- Backoff de notifications: 3 reintentos reales (1/5/30) y `failed` al cuarto — se corrige el test existente citando este spec.
- Poison pill: batch con una notificación que lanza → las demás se procesan.
- Timeout ambiguo de refund → `failed('ambiguous-timeout')` sin re-POST.
- Success page: cada status → mensaje correcto.
- Validación de filtros: fechas/uuid inválidos ignorados; rango invertido rechazado en export.
- Generador de instancias respeta `valid_from`/`valid_until`.

**CI**: el job nuevo de integración (C8) corre todo lo anterior en cada PR.

## 11. Plan de rollout

- **Sin feature flags.** Tres PRs secuenciales a `dev`, cada uno con squash merge y CI verde: (1) `fix/0028-dinero` — workstream A + migración `…040`; (2) `fix/0028-panel-portal` — workstream B + migración `…041`; (3) `chore/0028-deuda-menor-ci` — workstream C + migración `…042`. El orden importa: A cierra los críticos y no depende de B/C. (Desviación deliberada del formato "una rama por spec" del template: tres ramas del mismo spec para evitar un PR gigante — precedente: spec 0023 con PRs #43/#44/#45.)
- **Sin migración de datos**: el seed actual pasa los constraints de `…041` tal cual (§8) y prod aún no tiene datos reales.
- **Despliegue**: migraciones antes que el código (el cambio `void → text` de `confirm_booking` es backward-compatible con los callers desplegados). Las tres migraciones se suman al paquete del cutover.
- **Variables nuevas**: `ONVOPAY_API_BASE_URL` (web + worker, opcional con default prod); exigencias de producción del worker documentadas en el runbook de Railway.
- **Reversible**: cada PR se revierte de forma aislada; las migraciones documentan su down (la `…040` restaura la versión `…037` de `confirm_booking`).
- **Comunicación**: avisar al cliente del cambio de semántica de día en filtros/export y del renombrado `/hoy → /today`.

## 12. Métricas de éxito

- **Cero cobros huérfanos**: todo evento Sentry `webhook-late-payment` tiene su refund correspondiente en DB (query de conciliación en la verificación manual del cutover).
- **Cero refunds duplicados**: conteo de refunds por pago en OnvoPay dashboard = filas `succeeded` en `refunds` (spot-check del smoke test).
- **El export contable cuadra por día CR**: una reserva de tour a las 19:00 CR aparece en el día CR correcto (verificación manual con datos de staging).
- CI: los tests de integración corren y gatean en todos los PRs siguientes.

## 13. Preguntas abiertas

- [ ] **P1**: ¿OnvoPay expone `POST /payment-intents/{id}/cancel` (o equivalente)? **Dueño**: Kenneth (sandbox). **Antes de**: implementar A8 (cancelación best-effort del intent). El `GET /v1/refunds/{id}` que usa el camino verify de A4 YA está vetteado e implementado (`pollRefund`, 2026-06-02) — no depende de esta pregunta. **No bloquea** el resto del workstream A.
- [ ] **P2**: ¿OnvoPay rechaza un segundo refund que exceda el monto cobrado? **Dueño**: Kenneth (sandbox). **Antes de**: cutover. Determina la severidad residual del riesgo de doble refund (las defensas de código se implementan igual).
- [ ] **P3**: ¿Qué `amount`/`currency` reporta el webhook para un pago SINPE sobre un intent en USD? **Dueño**: Kenneth (sandbox). **Antes de**: go-live. Si produce mismatch, decidir producto (deshabilitar SINPE o soportar CRC) en spec futuro.
