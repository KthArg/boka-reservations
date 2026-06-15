# 0025 — Prevención de sobreventa (garantía de cupo + auto-refund de respaldo)

- **Estado**: approved
- **Autor**: kenneth
- **Creado**: 2026-06-14
- **Última actualización**: 2026-06-14 (aprobado por el usuario; decisiones de §13 resueltas: ventana de pago 30 min, estado `overbooked_refunded`, secuencial respecto a 0026. Antes, revisado por spec-reviewer: corregidos 5 bloqueantes — mecanismo real de encolado de refund, idempotencia en el camino del reconciliador sin `p_event_id`, hold en estado `paying` en vez de extender `expires_at`, `ALTER` del CHECK constraint de `bookings.status`, y la regla worker-sin-`@shared`)
- **Rama**: feat/0025-prevencion-sobreventa
- **PR**: #49

## 1. Contexto y motivación

Hoy una salida (`tour_instance`) puede **sobrevenderse**: terminar con más asientos confirmados que `capacity_total`. El spec 0023 (P2) agregó _detección_ —`confirm_booking` registra `audit_logs` `booking.overbooked` y los callers alertan a Sentry— pero **confirma igual** (no rechaza un pago ya hecho). El usuario pidió explícitamente **evitar la sobreventa a todo costo**; este spec cierra ese pedido pasando de _detectar_ a _prevenir_.

**Causa raíz (cómo ocurre hoy).** El cupo se reserva en dos momentos desacoplados:

1. **Hold** (`create_hold_atomic`, spec 0005): al entrar al checkout se crea un `tour_holds` con TTL de **15 minutos**. El hold NO incrementa `capacity_reserved`; cuenta para la disponibilidad solo vía `SUM(held_seats) WHERE status='active' AND expires_at > NOW()`.
2. **Confirmación** (`confirm_booking`, al llegar el webhook de pago): recién ahí se hace `capacity_reserved += seats` y el hold pasa a `converted`.

Entre ambos hay una ventana: si el **hold vence (15 min) antes de que el pago se confirme** —pago lento, SINPE, reintento de webhook, webhook perdido recuperado por la reconciliación—, el asiento vuelve a estar disponible. Un segundo turista puede tomar ese cupo (su hold pasa el chequeo porque el primero ya no cuenta) y pagar. Cuando ambos pagos confirman, `confirm_booking` incrementa `capacity_reserved` **dos veces** → `capacity_reserved > capacity_total`. La detección del 0023 lo registra, pero ya hay dos reservas `confirmed` para un mismo asiento.

El actor afectado es el **turista** (dos personas con reserva confirmada para el mismo cupo) y el **operador** (debe resolver el conflicto a mano, expuesto a una mala reseña o disputa).

## 2. Objetivos

- Garantizar la invariante: **una salida nunca termina con asientos `confirmed` que superen `capacity_total`** (no hay sobreventa confirmada), bajo concurrencia y con pagos lentos.
- No rechazar un pago de un turista que **mantuvo su cupo a tiempo** (el caso común no debe degradarse).
- Para el caso de borde inevitable (el cupo realmente se agotó cuando el pago se concreta), **reembolsar automáticamente** al turista y notificarle, en vez de confirmar una reserva que no se puede honrar.
- Mantener la observabilidad existente (audit + alerta a Sentry) actualizada al nuevo camino.

## 3. Fuera de alcance

- **No** se rediseña el modelo de cobro ni el widget de OnvoPay; el pago sigue siendo asíncrono vía webhook + reconciliación.
- **No** se implementa lista de espera (waitlist) ni reasignación a otra salida: el borde se resuelve con reembolso automático.
- **No** se cambia la política de reembolso comercial (24h, `shared/constants/policies.ts`); el auto-refund de sobreventa es un reembolso **total** independiente de esa política (el turista no recibió el servicio).
- **No** se aborda el guard defensivo de `payment_mismatch` dentro de `confirm_booking` (eso va en el spec 0026, aunque toca la misma función; ver §9 sobre orden de aterrizaje y de evaluación).
- **No** se gestiona la reducción de `capacity_total` por el operador cuando ya hay reservas (se detecta y audita, pero la resolución del exceso ya confirmado es manual; ver §8).

## 4. Historias de usuario

> Como turista que paga su tour, quiero que el asiento que reservé en el checkout siga siendo mío mientras se procesa mi pago, para no perderlo por una demora de la pasarela.

Criterios de aceptación:

- [ ] Mientras un pago está en curso (payment intent creado, reserva `pending_payment`), el cupo de esa reserva permanece reservado y **no** puede ser tomado por otro turista, aunque el pago tarde más que el TTL original de 15 min del hold.
- [ ] Si el pago se concreta antes de que la reconciliación cancele la reserva por abandono, la reserva se confirma normalmente.

> Como turista que paga justo cuando el cupo ya se agotó (caso de borde), quiero que se me reembolse automáticamente y se me avise, en vez de recibir una confirmación que no se puede honrar.

Criterios de aceptación:

- [ ] Si al confirmar un pago la salida ya no tiene cupo (confirmar superaría `capacity_total`), la reserva **no** queda `confirmed`: pasa al estado terminal `overbooked_refunded` y se encola un **reembolso total** del pago.
- [ ] El turista recibe un email explicando que el cupo se agotó y que se le reembolsó.
- [ ] El evento queda en `audit_logs` y alerta a Sentry.

> Como operador, quiero estar seguro de que nunca tendré dos reservas confirmadas peleando por el mismo asiento el día del tour.

Criterios de aceptación:

- [ ] Bajo dos pagos concurrentes por el último cupo, **exactamente uno** queda `confirmed`; el otro queda `overbooked_refunded` con refund encolado (test de concurrencia).
- [ ] `capacity_reserved` de una salida nunca supera `capacity_total` para reservas confirmadas.

## 5. Diseño técnico

Dos capas: la **Capa 1** previene el caso común (mantener el cupo reservado durante todo el ciclo de pago); la **Capa 2** garantiza la invariante en el borde inevitable (auto-refund). Ambas son necesarias.

> **Decisión de negocio tomada (resuelve la duda del review).** Ante el borde de cupo agotado se hace **auto-refund total automático**, no "notificar al operador para que gestione a mano". Razón: el pedido es _evitar la sobreventa a todo costo_; dejarlo en manos del operador deja una ventana en la que hay un pago sin reserva honrable y la invariante no está garantizada. El operador igual se entera (audit + Sentry + el email al turista).

### Capa 1 — Mantener el cupo reservado durante todo el ciclo de pago (estado `paying`)

El problema es que el hold (15 min) puede vencer antes de que el pago confirme, y `release-expired-holds` (worker) marca `active→expired` **ciegamente** cualquier hold con `expires_at < NOW()`. Por eso **no alcanza con extender `expires_at`**: hay que sacar el hold del conjunto que ese job libera.

- Se agrega el estado **`paying`** a `tour_holds.status`. Al crear el payment intent en `initCheckout` (`web/lib/booking/create.ts`), después de crear la reserva, el hold pasa de `active` a **`paying`**.
- **`create_hold_atomic`** (cálculo de disponibilidad) pasa a contar como ocupados los holds `status='active' AND expires_at > NOW()` **más** los `status='paying'` (estos últimos sin mirar `expires_at`: cuentan mientras el pago esté vivo).
- **`release-expired-holds`** queda **sin cambios**: solo toca `status='active'`, así que **no** libera un hold `paying`. Esto cierra el hueco (un hold `paying` nunca lo libera el job de expiración).
- El hold `paying` se resuelve solo cuando el pago **resuelve**: `confirm_booking` lo pasa a `converted`; la **reconciliación** (`cancel_stale_pending_booking`), al cancelar una `pending_payment` abandonada/fallida, lo pasa a `released`/`expired` (hoy ya marca el hold del booking como `expired`; se ajusta para cubrir `paying`).

Con esto, **la "ventana de pago" efectiva es el umbral de la reconciliación**: el cupo queda reservado mientras la reserva esté `pending_payment`, y solo se libera cuando la reconciliación la cancela (tras consultar a OnvoPay que no hubo pago). Ese umbral vive **en el worker** (`reconcile-pending-payments.ts`, hoy `STALE_PENDING_PAYMENT_AFTER_MS = 2h`, hardcodeado), **no en `@shared`** (regla `worker-no-shared-runtime`: el worker es self-contained). No se introduce ninguna constante compartida nueva.

**Tradeoff (documentado):** un checkout abandonado tras crear el payment intent retiene el cupo hasta que la reconciliación lo cancele. Con el umbral actual de 2h eso ata inventario demasiado tiempo; se **fija `STALE_PENDING_PAYMENT_AFTER_MS` en 30 min** (decisión 2026-06-14): cubre el peor caso de pago real (tarjeta + SINPE Móvil) sin atar inventario de más. La reconciliación nunca cancela un pago concretado: consulta OnvoPay antes (flujo del 0013/0014).

### Capa 2 — Guard de capacidad al confirmar + auto-refund de respaldo

`confirm_booking` deja de "confirmar igual ante sobrecupo" (0023) y pasa a **garantizar la invariante**. Cuerpo (preservando lo vigente: `is_public_request`, idempotencia, notificaciones):

1. **Idempotencia ampliada (cubre el camino del reconciliador).** Al inicio, además del guard actual `status='confirmed' → RETURN`, se agrega: `IF v_booking.status IN ('confirmed','overbooked_refunded') THEN RETURN`. Crítico porque el **reconciliador** llama `confirm_booking` **sin `p_event_id`** (`worker/src/reconciliation/repository.ts` → `confirmRecoveredBooking`), así que la idempotencia por `processed_webhook_events` NO aplica en ese camino: el guard por estado del booking es la **única** defensa contra un segundo refund. (Si en el futuro el reconciliador pasara `p_event_id`, sería defensa adicional, no sustituto.)
2. Con el lock `FOR UPDATE` sobre `tour_instances` (ya presente en `…035`): si `capacity_reserved + p_total_seats > capacity_total`, **no** se confirma. En su lugar:
   - `UPDATE bookings SET status='overbooked_refunded'` (NO incrementa `capacity_reserved`).
   - El pago entró (el turista pagó), así que se marca `UPDATE payments SET status='succeeded' WHERE booking_id=... AND external_payment_id=...` (igual que el camino feliz), para que el refund tenga un pago `succeeded` que reembolsar.
   - **Encolar el refund total** siguiendo el patrón existente de `cancel_booking` (`…029`): `INSERT INTO refunds (booking_id, payment_id, amount_cents, currency, reason, status)` con `amount_cents = payments.amount_cents` (total), `reason='overbooked_refunded'`, respetando el índice único `refunds_one_active_per_booking (booking_id) WHERE status<>'failed'` (un solo refund activo por reserva). El worker `process-refunds` (spec 0011) lo procesa contra OnvoPay y lo cierra con `settle_refund`.
   - El hold pasa a `released` (no `converted`).
   - `INSERT audit_logs 'booking.overbooked_refunded'` + el caller alerta a Sentry.
   - Se encola la notificación al turista (`overbooked_refunded`/email "cupo agotado + reembolso").

### Diagrama de flujo

```
checkout → createHold (active,15m) → booking pending_payment → payment intent
        → [Capa 1] hold → 'paying' (cupo reservado mientras viva el pago)
webhook succeeded  /  reconciliador (sin event_id) → confirm_booking (lock instancia):
   ├─ status ya confirmed|overbooked_refunded → RETURN (idempotente)
   ├─ cupo OK       → confirmed, capacity_reserved += seats, hold converted, notifica
   └─ cupo agotado  → overbooked_refunded (no incrementa), payment succeeded, INSERT refunds (total),
                      hold released, audit 'booking.overbooked_refunded' + Sentry, notifica al turista
pago falla / vence ventana → reconciliación cancela pending, hold paying → released
```

## 6. Modelo de datos

- **`bookings.status`**: nuevo valor terminal **`overbooked_refunded`**. Requiere `ALTER TABLE ... DROP CONSTRAINT bookings_status_check` + `ADD CONSTRAINT` con la lista ampliada (`pending_payment, confirmed, cancelled, refunded, payment_mismatch, overbooked_refunded`) — el CHECK real está en la migración `…025`; **no alcanza con tocar el enum de TS**. Reflejar también en `shared/constants/enums.ts` (`BookingStatus`) y en `web/types/database.ts` (**curado a mano**: agregar solo el literal, no regenerar con `pnpm db:types`).
- **`tour_holds.status`**: nuevo valor **`paying`** → `ALTER` del CHECK `status IN ('active','released','expired','converted','paying')`.
- **Funciones a auditar por filtros de status**: `report_*` (`…022`) y `pii_retention`/anonimización (`…034`) filtran por `status IN (...)`. Una reserva `overbooked_refunded` debe tratarse como una reserva cerrada **con PII** y pago reembolsado (análoga a `refunded`): NO cuenta como ingreso en reportes y SÍ entra en la anonimización por retención. Revisar y ajustar esos filtros.
- **Migración**: `2026XXXX_oversell_prevention.sql` — los dos `ALTER` de CHECK, la reescritura de `confirm_booking` (guard de capacidad + `overbooked_refunded` + encolado de refund + idempotencia ampliada) y de `create_hold_atomic` (contar holds `paying`). `confirm_booking` mantiene su **firma actual** (`RETURNS void`, mismos args) — ver nota de coordinación con 0026 en §9.

## 7. Estados y transiciones

`bookings` (cambios):

- Nuevo terminal **`overbooked_refunded`**: `pending_payment → overbooked_refunded` cuando el pago se concreta pero el cupo está agotado. No incrementa `capacity_reserved`; encola refund total; hold → `released`.
- `pending_payment → confirmed` (sin cambio) cuando hay cupo.
- `pending_payment → cancelled` (sin cambio) por abandono/falla vía reconciliación.

`tour_holds`: `active → paying` (al crear el payment intent) → `converted` (confirmado) | `released` (overbooked_refunded o cancelado). El `paying` no lo expira `release-expired-holds`.

`payments` / `refunds`: el pago de una `overbooked_refunded` queda `succeeded` con un `refunds` asociado que sigue la máquina del 0011 (`pending → processing → completed|failed`).

## 8. Casos borde y errores

- **Dos pagos concurrentes por el último cupo**: el `FOR UPDATE` sobre `tour_instances` serializa. El primero confirma (`capacity_reserved += seats`); el segundo ve el cupo lleno → `overbooked_refunded` + refund. Exactamente uno `confirmed`. Caso explícito de test: ambos con hold `paying` activo, capacidad para uno solo.
- **Camino del reconciliador (sin `p_event_id`)**: cubierto por el guard `status IN ('confirmed','overbooked_refunded') → RETURN`. Sin ese guard habría doble refund si el reconciliador corre dos veces; con él, idempotente.
- **`payment_mismatch` cruzado con `overbooked_refunded` (precedencia)**: hoy ambos callers validan monto y llaman `flag_payment_mismatch` **antes** de `confirm_booking`, así que un pago con monto incorrecto **nunca** llega al guard de capacidad. Cuando aterrice el guard interno de `payment_mismatch` (spec 0026), **mismatch se evalúa antes que capacidad** dentro de `confirm_booking` (no tiene sentido evaluar cupo de un pago de monto incorrecto).
- **El operador reduce `capacity_total`** por debajo de lo reservado: las `confirmed` se respetan; nuevas confirmaciones que excedan caen a `overbooked_refunded` + refund; la reducción se audita; el exceso ya confirmado es gestión manual (fuera de alcance).
- **Falla al encolar/insertar el refund** (p. ej. choque con el índice único): se registra el error y se alerta; la reserva igual queda `overbooked_refunded` (no `confirmed`), preservando la invariante; el operador puede reembolsar a mano (panel, flujo 0011).
- **Webhook reintentado / doble corrida**: idempotente por el guard de estado.

## 9. Impacto en otras áreas

- **DB**: reescribe `confirm_booking` (ruta de dinero) y `create_hold_atomic` → **payment-flow-auditor** + **db-schema-guardian** antes de mergear.
- **Callers de `confirm_booking`**: el **webhook** (`web/app/api/webhooks/onvopay/route.ts`) y la **reconciliación** (`worker/src/reconciliation/repository.ts`) hoy, **tras** el confirm, re-leen capacidad y emiten una alerta Sentry con fingerprint `booking-overbooked` (lógica del 0023). Esa alerta debe **retirarse/reemplazarse**: ahora el evento de borde es `booking.overbooked_refunded` y lo emite el camino nuevo. Si no se ajustan, la métrica de §12 nunca llega a cero.
- **Worker**: `process-refunds` procesa los refunds de sobreventa; `reconcile-pending-payments` libera holds `paying` al cancelar pending y su umbral (`STALE_PENDING_PAYMENT_AFTER_MS`) define la ventana de pago (ajuste en el worker, sin `@shared`).
- **Email**: nuevo template/notificación "cupo agotado + reembolso" (ES/EN).
- **Panel admin**: el estado `overbooked_refunded` se muestra en lista/detalle (badge + i18n ×2), análogo a `payment_mismatch`.
- **Solapamiento con 0026**: 0026 también reescribe `confirm_booking` (guard de `payment_mismatch`, que **sí** cambia la firma). **0025 aterriza primero**; 0026 reabsorbe sobre el `confirm_booking` de 0025. Orden de evaluación dentro de la función: idempotencia → `payment_mismatch` → capacidad/`overbooked_refunded` → confirmar. Coordinar para evitar doble migración de firma sobre los dos callers (se acepta el costo de dos pasos, o se bundlean; decisión en §13 del 0026).

## 10. Plan de tests

- **Integración (crítico, concurrencia)**: dos confirmaciones concurrentes por el último cupo → exactamente una `confirmed`, la otra `overbooked_refunded` con refund encolado; `capacity_reserved ≤ capacity_total`.
- **Integración**: con la Capa 1, un segundo turista NO puede tomar el asiento mientras el primer pago está `paying` (aunque pasen >15 min); el primer pago confirma.
- **Integración**: confirmar sobre cupo agotado → `overbooked_refunded`, no incrementa `capacity_reserved`, `payment` queda `succeeded`, se inserta un `refunds` total; segunda corrida (reconciliador sin `event_id`) → idempotente, sin 2º refund.
- **Integración (regresión)**: camino feliz (cupo disponible) confirma + notifica como hoy; idempotencia del webhook (`…024`) y validación de monto (0014) intactas; `create_hold_atomic` sigue rechazando `HOLD_NO_CAPACITY` correctamente contando holds `paying`.
- **Unit**: transición de estados; conteo de disponibilidad con `paying`.

## 11. Plan de rollout

- **Feature flag** opcional (env, p. ej. `OVERSELL_PREVENTION_ENABLED`) para volver al comportamiento "confirmar + alertar" del 0023 sin redeploy de DB; si se prefiere simplicidad, la migración es reversible restaurando `confirm_booking`/`create_hold_atomic` de `…035`/`…011`.
- **Migración de datos**: ninguna (sin backfill; `overbooked_refunded`/`paying` aplican a flujos nuevos).
- **Reversible**: sí (restaurar funciones; revertir los `ALTER` de CHECK requiere que no existan filas con los valores nuevos).
- **Comunicación al operador**: ahora algunas reservas de borde se auto-reembolsan (antes se confirmaban y él las gestionaba).

## 12. Métricas de éxito

- **0 reservas confirmadas en sobreventa** (`capacity_reserved ≤ capacity_total` para toda salida con reservas confirmadas) tras el deploy.
- Tasa de `overbooked_refunded` (auto-refunds por sobreventa) **muy baja** (idealmente ~0): si es alta, indica `STALE_PENDING_PAYMENT_AFTER_MS` muy corto o que la Capa 1 no conserva el cupo.
- **0 alertas `booking-overbooked`** del comportamiento viejo (reemplazadas por `booking.overbooked_refunded`) — requiere haber retirado las alertas de los dos callers (§9).

## 13. Preguntas abiertas

- **Decisión (resuelta, 2026-06-14)**: la ventana de pago efectiva (`STALE_PENDING_PAYMENT_AFTER_MS`) se fija en **30 minutos** (hoy 2h): holgada para tarjeta y SINPE Móvil, y libera el cupo de checkouts abandonados en media hora.
- **Decisión (resuelta, 2026-06-14)**: el estado terminal se llama **`overbooked_refunded`** (afecta CHECK + enum + i18n + `database.ts`).
- **Decisión (resuelta, 2026-06-14)**: **secuencial** — 0025 se implementa primero (mantiene la firma actual de `confirm_booking`); el guard de `payment_mismatch` del 0026 se aplica después, sobre el `confirm_booking` ya reescrito por 0025. Se acepta migrar la firma en dos pasos (toca los dos callers dos veces).
