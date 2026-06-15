# 0026 — Limpieza de deuda técnica menor

- **Estado**: approved
- **Autor**: kenneth
- **Creado**: 2026-06-14
- **Última actualización**: 2026-06-14 (aprobado por el usuario; los 3 ítems viajan juntos y se implementan después de 0025 — §13. Antes, revisado por spec-reviewer: corregida la atribución del ítem ya resuelto, nombrado el caller del worker que no pasa monto + regla worker-self-contained, fijado el orden de evaluación con 0025 y endurecido el criterio del ítem 3)
- **Rama**: chore/0026-deuda-tecnica-menor (cuando aplique)
- **PR**: #<número> (cuando aplique)

## 1. Contexto y motivación

A lo largo del proyecto se acumularon ítems de deuda menor **no bloqueantes**, anotados en la memoria y en la sección "Estado actual" del roadmap. Este spec los agrupa deliberadamente —a pedido del usuario— para cerrarlos de una pasada.

> **Nota de alcance (ítem ya resuelto, excluido).** Este spec originalmente iba a incluir _"escrituras sin chequeo de error en Server Actions (check-in / asignación de guía)"_. Al revisar el código, **ese ítem ya está resuelto**: `web/lib/booking/checkin-action.ts` (línea 50) y `web/lib/guides/assign-action.ts` (líneas 46, 51, 54, 70) chequean el `error` de cada escritura y devuelven `CheckInError.WriteFailed` / `GuideAssignmentError.WriteFailed`. La nota en la memoria que lo listaba como pendiente quedó **desactualizada** (la deuda se cerró en un fix previo; no se cita PR/commit específico por no poder verificarlo con certeza). Por eso **no** forma parte de este spec.

Quedan tres ítems:

1. **El panel de reservas no se auto-actualiza.** `/dashboard/bookings` es server-rendered sin push: una reserva confirmada por webhook aparece recién en la siguiente carga. El staff que mira la lista en vivo no ve entrar reservas hasta refrescar (F5).
2. **`confirm_booking` no tiene guard propio de `payment_mismatch`.** La validación de monto/moneda (spec 0014, `flag_payment_mismatch`) la hacen hoy los **callers** (webhook + reconciliación) **antes** de llamar `confirm_booking`. Si en el futuro se agrega un 3er caller (p. ej. "confirmar a mano" en el panel) que olvide validar, podría confirmarse un pago con monto incorrecto. Defensa en profundidad: centralizar el chequeo dentro de `confirm_booking`.
3. **La DB de dev acumula tours basura de tests.** Las suites de integración crean tours/instancias en la DB local compartida y no siempre limpian; quedan visibles en el portal (`Tour notif`, `Catarata ES`, `Salida ES`, etc.). Cosmético y solo en desarrollo, pero ensucia las verificaciones manuales (p. ej. recorridos con Playwright).

> **Heterogeneidad y riesgo (transparencia).** Los ítems 1 y 3 son cosméticos/triviales y reversibles con un revert. El **ítem 2 es de otra categoría**: cambia la **firma de una función de dinero** (`confirm_booking`), toca dos callers reales (uno en el worker), requiere migración y revisión de **payment-flow-auditor + db-schema-guardian**, y se coordina con el spec 0025. Se bundlean a pedido explícito del usuario (decisión 2026-06-14: los tres ítems viajan juntos en este spec/PR; ver §13).

Actores: **staff/operador** (ítems 1 y 3) y **turista** indirectamente (ítem 2 protege la integridad del cobro ante cambios futuros).

## 2. Objetivos

- Permitir que el panel de reservas refleje datos nuevos sin recargar la página entera a mano.
- Hacer que `confirm_booking` marque como `payment_mismatch` una confirmación cuyo monto/moneda no coincida con lo esperado, sin depender de que el caller lo valide.
- Dejar la DB de dev sin datos de prueba tras correr las suites, sin fragilizar los tests.

## 3. Fuera de alcance

- **No** se implementa Supabase Realtime ni websockets para el panel (demasiado peso; se elige la opción liviana — §5).
- **No** se construye un botón "confirmar pago a mano" en el panel (es el hipotético 3er caller que motiva el guard, pero no se crea acá).
- **No** se cambia `flag_payment_mismatch` (0014) ni el comportamiento de los callers actuales: el guard interno es **aditivo / defensa en profundidad**.
- **No** se aborda la prevención de sobreventa (spec 0025), aunque también modifica `confirm_booking` — ver §9 (orden de aterrizaje y de evaluación).
- **No** se borran datos de producción (el ítem 3 es exclusivamente de desarrollo/CI).

## 4. Historias de usuario

> Como staff mirando el panel de reservas durante una jornada, quiero actualizar la lista sin perder mis filtros ni recargar toda la página, para ver las reservas que entran por webhook.

Criterios de aceptación:

- [ ] `/dashboard/bookings` ofrece un botón "Actualizar" que recarga los datos del servidor conservando los filtros (query params), vía `router.refresh()`, sin recargar la app completa.

> Como sistema, quiero que `confirm_booking` no confirme un pago cuyo monto no coincide con lo esperado, aunque el caller no lo haya validado, para proteger la integridad del cobro.

Criterios de aceptación:

- [ ] `confirm_booking` recibe el monto/moneda pagados y verifica que coincidan con `payments.amount_cents`/`currency` (moneda normalizada a mayúsculas) antes de confirmar; si no coinciden, no confirma y deja la reserva en `payment_mismatch`, registrando el `audit_logs` `booking.payment_mismatch` (preservando la trazabilidad de `flag_payment_mismatch`), de forma idempotente.
- [ ] Los dos callers actuales (webhook y reconciliación) siguen funcionando; su validación previa sigue (ahora redundante pero inofensiva).

> Como desarrollador, quiero que la DB local quede sin tours de prueba tras correr los tests.

Criterios de aceptación:

- [ ] Tras correr las suites de integración (`pnpm test:integration`), el conteo de tours vuelve a la **línea base del seed**: no quedan tours/instancias netos creados por los tests. La verificación mide el invariante completo —`SELECT count(*) FROM tours` == la cantidad sembrada por `seed.sql` (equivalentemente, 0 tours fuera del conjunto del seed)— y **no** una lista de prefijos: las suites usan ~25 marcadores de slug distintos (`integration-*`, `checkout-*`, `retention-`, `overbook-`, `notif-enqueue-`, `pay-mismatch-`, `webhook-*`, `report-`, `dep-`, `gv-`, `grd-`, `chk-`, `cxl-`, `repo-`, `test-tour`, `pricing-test`, `anon-tour`, `rls-active-`, …), así que enumerarlos es frágil e incompleto. `npx supabase db reset` queda documentado como reinicio determinístico, pero el criterio se cumple por teardown, no por el reset.

## 5. Diseño técnico

### Ítem 1 — Auto-actualización del panel

Componente cliente con un botón **"Actualizar"** que llama `router.refresh()` (revalida los Server Components de la ruta conservando URL/filtros). Opcional: auto-refresh con `setInterval` cancelable detrás de un toggle, sin suscripciones. Se descarta Supabase Realtime (peso/complejidad). Afecta solo `web/app/[locale]/(admin)/dashboard/bookings/` (la página + un pequeño componente cliente) + una clave i18n ES/EN.

### Ítem 2 — Guard de `payment_mismatch` en `confirm_booking`

`confirm_booking` recibe hoy `(p_booking_id, p_external_payment_id, p_total_seats, p_event_id)` y **no** conoce el monto pagado. Se le agregan parámetros **`p_paid_amount_cents`, `p_paid_currency`** y, con el lock de la reserva, compara contra `payments.amount_cents`/`currency` (normalizando moneda a mayúsculas, igual que 0014). Si no coinciden, transiciona a `payment_mismatch` e inserta `audit_logs 'booking.payment_mismatch'` (misma semántica observable que `flag_payment_mismatch`), sin confirmar. **Orden interno de la función**: (1) guard idempotencia (`status` terminal → RETURN), (2) **mismatch de monto** (este ítem), (3) capacidad/`overbooked_refunded` (spec 0025), (4) confirmar. El mismatch va antes que la capacidad: no tiene sentido evaluar cupo de un pago de monto incorrecto.

**Callers — ambos deben pasar el monto, incluido el del worker que hoy no lo hace:**

- **Webhook** (`web/app/api/webhooks/onvopay/route.ts`): ya tiene `payload.amountCents`/`payload.currency`; los pasa.
- **Reconciliación** (`worker/src/reconciliation/repository.ts` → `confirmRecoveredBooking`): hoy recibe solo `(bookingId, externalPaymentId, totalSeats)` y **NO** el monto. El monto/moneda sí existen en `recover()` (`worker/src/jobs/reconcile-pending-payments.ts`, `result.amountCents`/`result.currency`) pero no se propagan a `confirmRecoveredBooking`. Hay que **ampliar la firma de `confirmRecoveredBooking`** y propagar el monto desde `recover()`. El worker es **self-contained** (regla `worker-no-shared-runtime`): cualquier tipo/constante nuevo se define en el worker, **no** se importa de `@shared` en runtime. Nota: el reconciliador seguirá llamando `confirm_booking` **sin `p_event_id`** tras el cambio de firma (no asumir que hay que empezar a pasarlo); la idempotencia en ese camino la da el guard por estado del booking que introduce 0025.

Cambia la **firma** de `confirm_booking` → impacta `web/types/database.ts` (**curado a mano**: portar la firma nueva, no regenerar con `pnpm db:types`).

### Ítem 3 — Limpieza de la DB de dev

Causa: las suites de integración insertan tours/instancias y el teardown no siempre los borra; además usan **~25 patrones de slug distintos** (`integration-concurrency-test`, `integration-availability-test`, `checkout-price-`, `checkout-consent-`, `retention-`, `overbook-`, `notif-enqueue-`, `pay-mismatch-`, `webhook-handler-`, `webhook-idem-`, `report-`, `dep-`, `gv-`, `grd-`, `chk-`, `cxl-`, `repo-`, `test-tour`, `pricing-test`, `anon-tour`, `rls-active-`, …), por lo que limpiar "por una lista de prefijos" es frágil e incompleto. Solución preferida: **cada suite borra lo que creó en su propio teardown**, por los `id`/`slug` que ella misma insertó (no por una lista global de prefijos). Para hacerlo enforceable, se adopta una **convención única**: o bien un helper de factory que registre los ids creados y los borre en `afterAll`/`afterEach`, o bien un prefijo de slug común para todo dato de test que el teardown global elimine. Los tests comparten la DB local y corren con `fileParallelism:false` (sin paralelismo entre archivos, ver `web/vitest.integration.config.ts`), así que el borrado acotado a lo propio de cada suite es seguro. Complementariamente, `npx supabase db reset` queda como reinicio determinístico documentado (reaplica migraciones + seed limpio).

## 6. Modelo de datos

- **Ítem 2**: cambia la **firma** de `confirm_booking` (agrega `p_paid_amount_cents`, `p_paid_currency`). No agrega tablas/columnas; reutiliza el estado `payment_mismatch` (0014). Migración nueva que reescribe `confirm_booking` con la firma ampliada + el guard. Portar la firma a `web/types/database.ts` a mano.
- **Ítems 1 y 3**: sin cambios al modelo de datos.

## 7. Estados y transiciones

- **Ítem 2**: reusa `pending_payment → payment_mismatch` (0014), ahora también alcanzable desde dentro de `confirm_booking`. No introduce estados nuevos.
- Ítems 1 y 3: no aplican.

## 8. Casos borde y errores

- **Ítem 2**: webhook reintentado sobre una reserva ya `confirmed` → el guard de idempotencia (que va **primero**) retorna sin re-evaluar mismatch; sobre una ya `payment_mismatch` → idempotente. Monto coincidente → comportamiento idéntico al actual. Moneda en distinta capitalización (`usd` vs `USD`) → normalizar antes de comparar. Coexistencia con 0025: si monto incorrecto Y cupo agotado, gana el mismatch (se evalúa antes).
- **Ítem 1**: refrescar con filtros activos no los pierde (viven en query params, que `router.refresh()` conserva); lista vacía → estado vacío normal.
- **Ítem 3**: el teardown acotado a lo que cada suite creó no debe tocar datos de seed legítimos ni correr nunca contra prod (solo local/CI).

## 9. Impacto en otras áreas

- **Ítem 2 toca `confirm_booking` (pagos)** → **payment-flow-auditor** + **db-schema-guardian**, actualización de `database.ts` a mano, y cambios en **ambos callers** incluido el del worker (`confirmRecoveredBooking` + propagación del monto desde `recover()`).
- **Solapamiento con 0025**: ambos reescriben `confirm_booking`. **0025 aterriza primero**; el guard de mismatch se aplica sobre el `confirm_booking` de 0025, en el orden interno (idempotencia → mismatch → capacidad/overbooked_refunded → confirmar). 0025 **mantiene** la firma; este ítem **la cambia** → coordinar para no migrar la firma dos veces sobre los dos callers (ver §13).
- **Ítem 1**: UI del panel (admin), sin impacto en datos.
- **Ítem 3**: tooling de tests / entorno dev; sin impacto en prod.
- **i18n**: el botón "Actualizar" suma una clave ES/EN.

## 10. Plan de tests

- **Ítem 1**: test de componente del botón (dispara `router.refresh`); verificación manual de que conserva filtros. Baja criticidad (UI).
- **Ítem 2** (crítico, pagos): integración — confirmar con monto correcto → `confirmed`; con monto incorrecto → `payment_mismatch`, no confirma, inserta audit, idempotente ante reintento; el caller del worker propaga el monto y dispara el mismo camino. Regresión: idempotencia del webhook y validación de monto del 0014 intactas.
- **Ítem 3**: tras correr las suites, la verificación de "0 tours de prueba" pasa; `db reset` deja la DB en estado de seed.

## 11. Plan de rollout

- **Migración de datos**: ninguna.
- **Ítem 2**: reversible restaurando la firma/cuerpo previo de `confirm_booking` (y la firma de `confirmRecoveredBooking`). Coordinar el orden con 0025 (§9, §13).
- **Ítems 1 y 3**: sin estado persistente; reversibles con revert.
- No requiere feature flag ni comunicación al operador.

## 12. Métricas de éxito

- **Ítem 1**: el staff ve reservas nuevas sin F5 (validación cualitativa con el operador).
- **Ítem 2**: 0 confirmaciones con monto no coincidente que escapen al guard (test; defensa para callers futuros).
- **Ítem 3**: la DB de dev queda sin tours de prueba tras la corrida de suites (verificable con el `SELECT count(*)` de §4).

## 13. Preguntas abiertas

- **Decisión (resuelta, 2026-06-14)**: el ítem 2 **viaja junto con los ítems 1 y 3** en este mismo spec/PR (no se separa), y se implementa **secuencialmente después de 0025** — sobre el `confirm_booking` ya reescrito por 0025. La firma de `confirm_booking` se migra en dos pasos (0025 la mantiene, 0026 la cambia); se acepta ese costo sobre los dos callers.
- [ ] **Pregunta**: ¿El panel necesita auto-refresh periódico (cada N s) además del botón manual, o alcanza con el botón? **Dueño**: kenneth **Antes de**: implementación.
