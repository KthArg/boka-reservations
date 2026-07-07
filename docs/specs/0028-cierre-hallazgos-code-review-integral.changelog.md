# Changelog — 0028 Cierre de hallazgos del code review integral

Spec: [0028-cierre-hallazgos-code-review-integral.md](./0028-cierre-hallazgos-code-review-integral.md)
Ramas: `fix/0028-dinero` (workstream A), `fix/0028-panel-portal` (workstream B), `chore/0028-deuda-menor-ci` (workstream C)

## 2026-07-07 — Workstream B implementado (panel/portal); verificación corriendo

**Hecho**:

- Migración `20260706000041`: EXCLUDE anti-solape en `tour_pricing` (solo filas con fechas, btree_gist, bounds `[]`), UNIQUE parcial de un precio base activo por `(tour, ticket_type)`, CHECK de `currency` (USD/CRC) en bookings/payments/refunds, UNIQUE `tour_instance_guides(tour_instance_id)`, 6 índices de FKs + funcional `lower(customer_email)`.
- **Precios deterministas** (B1): `selectEffectivePricing` (temporada > base) como único punto de selección, consumido por checkout (`loadActivePricing`), detalle público (`getTourPricing`) y "desde $X" del listado (que ahora usa el filtro canónico). `detectPricingOverlaps` con bordes inclusivos, temporadas abiertas (un solo límite) y códigos de error.
- **`updateTour` confiable** (B1): `reconcileRows` nuevo (el form es el estado final: elimina filas quitadas + upsert, todo chequeado; FK de horarios en uso → código propio; violaciones de constraints …041 mapeadas a códigos). Actions de tours devuelven códigos `tour_*` traducidos en `TourForm`/`ArchiveTourButton` (i18n es/en); mensajes de Zod por campo quedan como texto (deuda menor aceptada).
- **Archivado coherente** (B12): con reservas activas futuras se bloquea (`tour_archive_has_bookings`); sin ellas, instancias futuras `available` → `cancelled`. Botón cliente nuevo (`ArchiveTourButton`) para mostrar el rechazo (el `<form action>` descartaba el resultado).
- **Middleware sin loop** (B3): si el primer segmento no es un locale válido, se devuelve el redirect de next-intl y el guard corre sobre la URL localizada; tests del camino (incluye `/fr/dashboard`).
- **Día del negocio único = día CR** (B4): helper `web/lib/dates/cr-date.ts` (`crDate`, `crDayStartIso`, `crNextDayStartIso`); filtros del listado admin y export CSV con límites `[inicio día CR, día CR siguiente)`; `pricingToday()` en fecha CR; `reports/range.ts` consume el helper compartido.
- **Success page honesta** (B5): `confirmed` → confirmación; `pending_payment` → "procesando" ; otro/inexistente → mensaje neutro (claves i18n nuevas).
- **Hold fuera del render** (B6): `releaseHeldBooking` en `lib/booking/release-hold.ts` (cookie + chequeo de error + constantes `HoldStatus`); la page de cancel delega. `HOLD_SESSION_COOKIE` deduplicada a shared.
- **Portal sin pasado** (B7): `getUpcomingInstances` filtra `starts_at >= now`; `HOLD_INSTANCE_PAST` → error i18n `instance-past`.
- **Filtros validados** (B8): `dateFrom/dateTo` formato estricto, `tourId` UUID (inválidos se ignoran); export rechaza rango invertido.
- **Guía atómico** (B9): upsert `ON CONFLICT (tour_instance_id)` (sin delete+insert).
- **Magic links con throttle** (B10): `isMagicLinkThrottled` (300/h por IP, store del 0017, fail-open sin request context) en ambos validadores; excedido = misma respuesta que token inválido.
- **Env de web al boot** (B11): `instrumentation.ts` importa `lib/env` (runtime nodejs); `RESEND_API_KEY` eliminada del schema web (no la usa); `ONVOPAY_API_BASE_URL` agregada; `supabase-service` y `payments/index` consumen la env tipada.
- **B13**: exports 400 con códigos estables; `BookingDetailView` traduce `n.status`; reset-password con clave de error real (`password-invalid`).
- Tests nuevos: `cr-date` (bordes 18:00/23:59/00:00 CR), `select-effective` (prioridad), `validation-overlaps-0028` (bordes inclusivos/abiertas/códigos), middleware (loop, redirectTo, locale inválido), admin-filters (inválidos ignorados, rango invertido); integración `tour-pricing-constraints` (EXCLUDE con borde compartido, base duplicado, reconciliación elimina/upsertea + mapeo de códigos, upserts concurrentes de guía → 1 fila).

**Por qué / decisiones**:

- Prioridad temporada>base en UN punto (`selectEffectivePricing`) y no en SQL: display y cobro comparten la misma función; los constraints …041 garantizan a lo sumo 1+1 filas vigentes.
- `archiveTour` usa el service client tras el guard de rol (las instancias las administra el sistema; no hay RLS de escritura admin sobre `tour_instances`).
- Throttle de magic links con límite MUY holgado (300/h): la barrera real es la entropía del token; esto solo corta el vector de carga sin molestar NAT compartido ni turistas refrescando.

**Pendiente**:

- Verificación completa + reviews obligatorios + PR del workstream B (stacked sobre #67).

## 2026-07-06 — Reviews pre-PR del workstream A aplicados

**Hecho**:

- Corrieron los 3 revisores obligatorios sobre el diff. Veredictos: payment-flow-auditor **APTO** (los 5 hallazgos originales CERRADOS con evidencia); db-schema-guardian y code-reviewer **requirieron cambios**, todos aplicados:
  - **Guard de elegibilidad en el camino late** (bloqueante del guardián): solo un pago `pending`/`failed` califica como tardío (`UPDATE … WHERE status IN (…) RETURNING`); un pago ya `succeeded` (reserva confirmada→cancelada <24h sin derecho a refund, o refund `failed` en retry) → `ignored`. Cerraba un refund contra-política y un doble refund posible. + `refund_enqueued` veraz en el audit, down de `flag_payment_mismatch` documentado, nota de lock-order, comentario del gate en `ignored`.
  - **Off-by-one del backoff de refunds** (M-1): el reintento de 30 min era inalcanzable; ahora `attempts > MAX_CREATE_ATTEMPTS` (4 intentos, esperas 1/5/30), espejo del fix de notifications.
  - **Guard del retry manual peligroso** (M-2): `failed('processing-stale'/'ambiguous-timeout')` SIN `external_refund_id` → `RefundRetryError.RequiresManualCheck` (constante compartida `REFUND_MANUAL_CHECK_REASONS`, mensaje i18n es/en en el botón del panel). El §8 del spec se corrigió (afirmaba que ese retry entraba por verify; el id nunca se persistió).
  - **Tests faltantes del plan §10** (A-1): unit del webhook (error de query → 500, fila inexistente → 404, outcome late → alerta, RPC error → 500) y del poison pill del batch de notifications (+ markSent fallido no re-envía). Integración nueva: replay sobre confirmada→cancelada <24h no encola refund.
- Follow-ups aceptados sin bloquear (del payment-flow-auditor, fallan del lado seguro): (1) un refund verificado como `failed` en OnvoPay no puede re-crearse desde el panel (requiere limpiar el id en DB) — dead-end operativo a resolver en un spec futuro junto a P2; (2) runbook de Railway: drain ≥ 30 s para el graceful shutdown; (3) `fetchActiveRefunds` puede demorar un ciclo con lote lleno de filas en backoff (irrelevante al volumen actual).

**Por qué / decisiones**:

- El guard de elegibilidad se implementó en vez de solo documentarse: es defensa en profundidad dentro de la función de dinero (precedente 0026) y el workstream C purgará `processed_webhook_events` (90 días), lo que erosiona el gate por evento para replays muy tardíos.

**Pendiente**:

- Verificación final (typecheck+lint+unit+integración) y PR del workstream A.

## 2026-07-06 — Workstream A implementado (dinero); integración corriendo

**Hecho**:

- Migración `20260706000040`: `confirm_booking` → `RETURNS text` con outcome, gate real por evento (`processed_webhook_events` con INSERT verificado), camino `late_payment_refunded` (pago `succeeded` + refund total + audit), asientos derivados de la reserva (`p_total_seats` deprecated con DEFAULT NULL), audit en camino feliz, liberación de hold en mismatch; `flag_payment_mismatch` también libera el hold. REVOKE re-aplicado + GRANT explícito a service_role.
- Checkout (`create.ts`): INSERT de `payments` chequeado; si falla → `cancelPaymentSession` best-effort (método nuevo en `PaymentProvider` + adapter) + release inmediato del hold; el widget jamás recibe un intent no persistido.
- Webhook: `maybeSingle` + error de query → 500; lectura de `bookings` eliminada; consume el outcome (alertas por fingerprint: late/overbooked/ignored).
- Reconciliador: `confirmRecoveredBooking` devuelve el outcome (sin `p_total_seats`, sin re-lectura de status); `recover()` extraído a `reconciliation/recover.ts` y alertas a `reconciliation/alerts.ts` (límite 150 líneas).
- Refunds worker: camino verify para `pending` con `external_refund_id` (jamás re-POST), `ambiguous-timeout` → failed + Sentry error, backoff real 1/5/30 desde `updated_at`, `markProcessing` con retry + alerta crítica con el id, guard `isRunning`, aislamiento por ítem; `processOne` extraído a `refunds/handle-refund.ts`. Retry manual web (`retry-action.ts`): con `external_refund_id` → `processing` (verify), sin id → `pending`.
- Notifications worker: timeout 15s en Resend y mailpit, guard `isRunning`, try/catch por ítem (poison pill → transitorio del ítem), off-by-one del backoff corregido (3 reintentos reales 1/5/30), escrituras chequeadas, `markSent` fallido → Sentry error sin re-envío.
- Worker `index.ts`: scheduler unificado + graceful shutdown SIGTERM/SIGINT (espera ciclos en curso, tope 30s).
- Env worker: `ONVOPAY_SECRET_KEY` y `EMAIL_PROVIDER=resend` obligatorios en producción; `ONVOPAY_API_BASE_URL` nueva (default prod) consumida por los 3 clientes OnvoPay (web adapter + 2 worker); `.env.example` ×2 actualizados.
- `shared/`: `ConfirmBookingOutcome` nuevo, `NotificationKind.OverbookedRefunded`, `AuditAction` completado; `web/types/database.ts` editado A MANO (outcome union, `p_total_seats` opcional).
- Tests: unit worker 81 ✓ (nuevos: backoff-no-elapsed, ambiguous-timeout, pending-con-id→verify, markProcessing fallido; actualizados: backoff off-by-one citando spec, reconcile outcome-driven); unit web 183 ✓ (nuevo `init-checkout-failures.test.ts` ×4); integración nueva `late-payment-refund.test.ts` (late+idempotencia+concurrencia+mismatch-monto, asientos autoritativos, hold liberado ×2).

**Por qué / decisiones**:

- `markProcessing` fallido tras POST exitoso NO libera el claim (release → pending sin id → re-POST → doble refund); se reintenta una vez y se alerta con el `external_refund_id` en el mensaje para resolución manual.
- `markSent` fallido tras enviar NO reintenta el envío (el Idempotency-Key de Resend acota el reenvío del próximo ciclo; con mailpit —solo dev— puede duplicar). Alerta `notif-mark-sent-failed`.
- Clientes OnvoPay reciben `baseUrl` por parámetro (no importan env): quedan puros y testeables.

**Pendiente**:

- Correr `test:integration` (web + worker) contra la migración `…040` local; reviews obligatorios (code-reviewer, db-schema-guardian, payment-flow-auditor); PR.

## 2026-07-06 — Spec aprobado, arranca workstream A (dinero)

**Hecho**:

- Code review integral ejecutado con 5 subagentes (reporte entregado en sesión; hallazgos resumidos en la memoria `pre-production-checklist`).
- Spec 0028 escrito, revisado por spec-reviewer en dos rondas (2 bloqueantes de diseño resueltos: semántica de precios base+temporada con prioridad determinista, y gate de idempotencia por evento en `confirm_booking`) y aprobado por Kenneth.

**Por qué / decisiones**:

- Tres PRs secuenciales en vez de uno gigante (precedente spec 0023).
- Precios: se conserva "base + temporadas" y la temporada gana (opción b del spec-reviewer); la alternativa (prohibir coexistencia) cambiaba el modelo que el formulario ya permite.
- Reserva `cancelled` con pago tardío reembolsado termina `refunded` vía `settle_refund` (semántica 0011 existente, no se pelea contra el pipeline).

**Pendiente**:

- Implementar A1–A8 en `fix/0028-dinero` (migración `20260706000040` + web + worker + tests).
