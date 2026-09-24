# 0033 — Cobro automático del mínimo, con autorización previa y momento configurable por tour

- **Estado**: approved
- **Autor**: Kenneth (con Claude Code)
- **Creado**: 2026-09-23
- **Última actualización**: 2026-09-23
- **Rama**: feat/0033-cobro-automatico-minimo
- **PR**: (sin asignar)

## 1. Contexto y motivación

El spec 0029 dividió el cobro diferido en tres partes. Las dos primeras están en el repo: la tarjeta se guarda al reservar, el staff cobra a mano desde el panel, y hay red de seguridad para rechazos, 3DS, intents colgados y cancelaciones. **La tercera nunca se implementó**: no existe el motor que evalúa el mínimo y cobra solo. Las columnas del mínimo de `tour_instances` están en el esquema desde la migración `…043` y hoy siempre valen `NULL`.

Este spec construye ese motor, con dos diferencias respecto de lo que preveía el 0029.

**1. Se autoriza antes de cobrar.** Con un mínimo de 5 y 5 reservas, si al cobrar entran 3 y fallan 2, la salida no alcanza el mínimo, hay que cancelarla y reembolsar esos 3 cobros: unos US$9,18 de costo de procesamiento tirados en una salida de 5 personas a US$60 que nunca ocurrió. La captura manual lo evita, y está verificada en sandbox el 2026-09-23: confirmar con `captureMethod: 'manual'` deja la intención en `requires_capture` (plata reservada, sin cobrar); `capture` la cobra; `cancel` la suelta **sin dejar transacción de balance, o sea sin costo**. El cobro de una salida pasa a ser todo o nada.

**2. El momento del cobro se elige por tour.** Hoy `business_settings.minimum_decision_window_hours` ni siquiera dispara nada: solo alimenta `compute_recovery_deadline`. El operador necesita decidir por tour entre cobrar apenas junta la gente o cobrar a X horas de la salida.

**Esto revierte una decisión del 0029** (§3, §5.1 y su Q6: "no se autoriza el monto ni se retienen fondos"). El descarte se basaba en el límite de 30 días de la captura manual, que impide autorizar **al reservar**; acá se autoriza **al cobrar**, minutos u horas antes de capturar. Queda registrado en `.claude/memory/decisions.md` (2026-09-23) con su bloque de verificación de servicio externo, y se reabre Q6 del 0029 con la fecha y la razón.

## 2. Objetivos

- Que una salida se cobre sola cuando llega su momento.
- Que ninguna salida cancelada por no alcanzar el mínimo le cueste costos de procesamiento al operador.
- Que cada tour defina si se cobra al cumplirse el mínimo o a X horas de la salida.
- Que ninguna salida llegue a su fecha sin resolver, ni con gente sin cobrar.
- Que el turista pueda cancelar aunque su autorización esté viva.
- Que el staff vea el estado del cobro de cada salida y decida cuando haya plata de por medio.

## 3. Fuera de alcance

- No se cambia la política de cancelación ni el reembolso menos costo de procesamiento (specs 0011 y 0032).
- No se cambia el checkout con cobro inmediato, que es el que se lanza (`DEFERRED_CHARGE_ENABLED=false`).
- No se cambia el backoff de reintentos (1 h, 6 h, 24 h) ni el cambio de tarjeta ni el 3DS. Sí cambia, y se documenta acá, quién los agenda y qué plazo los acota.
- No se agrega SINPE Móvil ni otro método: la captura manual de OnvoPay solo admite `card` (`openapi.yaml`, descripción de `captureMethod`).
- No se implementa la cancelación de una salida por decisión del operador fuera del flujo del mínimo.
- No se cambia el cobro manual del panel.
- No se activa la política de reembolso menos comisión: `REFUND_FEE_FROM_TERMS_VERSION` sigue en `null` aunque este spec suba `TERMS_VERSION` (§5.12).

## 4. Historias de usuario

> Como operador, quiero elegir por tour cuándo se le cobra al turista.

- [ ] El formulario del tour permite elegir entre "al cumplirse el mínimo" y "antes de la salida".
- [ ] Con "antes de la salida" se indica cuántas horas antes; vacío usa el valor global.
- [ ] Con menos de 6 horas, el formulario avisa que un rechazo no alcanza a reintentarse.
- [ ] Los tours existentes quedan en "antes de la salida" con el valor global.

> Como operador, quiero que una salida que no junta gente no me cueste plata.

- [ ] Al llegar el momento, se autoriza a todas las reservas sin cobrar de la salida, sin capturar.
- [ ] Si las autorizaciones alcanzan el mínimo, se capturan todas y la salida queda confirmada.
- [ ] Si no lo alcanzan, no se captura nada: las autorizaciones se sueltan sin costo.
- [ ] Si alguna reserva de esa salida ya estaba cobrada, la decisión pasa al staff y, si cancela, esas reservas reciben el 100 %.

> Como turista, quiero tiempo para resolver un rechazo, y poder cancelar mientras tanto.

- [ ] Si mi cobro falla, recibo el aviso con el enlace para cambiar la tarjeta.
- [ ] La salida no se cancela mientras queden reintentos y el plazo no haya vencido.
- [ ] Si cancelo con mi autorización viva, se suelta y mi reserva queda cancelada sin cobro.
- [ ] Si la salida se cancela por mínimo, el email me dice que no hubo cobro y que la retención puede tardar unos días en desaparecer de mi estado de cuenta.

> Como staff, quiero ver y decidir sobre el cobro de cada salida.

- [ ] El panel muestra, por salida, el estado del cobro y los cupos autorizados contra el mínimo.
- [ ] Las salidas que esperan mi decisión aparecen en una bandeja, con confirmar o cancelar.
- [ ] Si nadie decide, la salida se cancela sola antes de su fecha y el equipo recibe una alerta.

## 5. Diseño técnico

### 5.1 Configuración

En `tours`:

- `charge_timing text NOT NULL DEFAULT 'before_departure'`, CHECK en `('on_minimum', 'before_departure')`.
- `charge_lead_hours integer NULL`, CHECK entre 1 y 720. `NULL` = usar el valor global. Se permite desde 1 hora (decisión del usuario, 2026-09-23); con menos de 6 el formulario avisa que un rechazo queda sin reintentos, porque `charge_attempt_failed` exige 2 horas de margen para agendar uno.

En `business_settings`: `default_charge_lead_hours integer NOT NULL DEFAULT 48`, CHECK 1 a 720, con su `GRANT UPDATE` a `authenticated`. **Columna nueva**: `minimum_decision_window_hours` se queda como está, alimentando `compute_recovery_deadline` del cobro manual. Mezclarlas haría que cambiar el plazo del cobro moviera sin querer el del panel.

En `tour_instances`: `minimum_charge_closed_at timestamptz NULL`, la marca de un ciclo cerrado sin resolver (§5.5).

Constantes espejadas en el worker (no importa `@shared` en runtime, como `worker/src/charges/statuses.ts`): `ChargeTiming = { OnMinimum: 'on_minimum', BeforeDeparture: 'before_departure' }`.

Los plazos del ciclo (`MINIMUM_RESOLUTION_WINDOW_HOURS = 48`, `MINIMUM_RESOLUTION_MARGIN_HOURS = 3`, `MINIMUM_RESOLUTION_FLOOR_MINUTES = 30`, `EARLY_CANCEL_FLOOR_HOURS = 72`) viven como literales comentados dentro de las funciones SQL, que es donde se aplican, con el precedente de los plazos de `…044`. El worker no los necesita: pregunta a la base.

### 5.2 Cuándo corresponde cobrar una salida

`departure_charge_due(p_instance_id uuid) → boolean` es **la única fuente de la regla**; no se duplica en TypeScript. Devuelve verdadero cuando:

- `before_departure`: `now() >= starts_at - COALESCE(tours.charge_lead_hours, business_settings.default_charge_lead_hours)`.
- `on_minimum`: los cupos vendidos llegan al mínimo (sin tope de anticipación: si junta la gente con meses, se cobra ahí, decisión del usuario del 2026-09-23), **o** se cumple la condición de `before_departure`, que es el disparo de respaldo para una salida que nunca junta el mínimo.

**Y en los dos casos**, falso mientras `minimum_charge_closed_at IS NOT NULL AND now() < starts_at - EARLY_CANCEL_FLOOR_HOURS` (72 h). Cuando vuelve a ser verdadera, el ciclo **se reabre de cero**: disparo, foto del mínimo y plazo nuevos (§5.3, paso 2). Sin eso, un disparo viejo dejaría el plazo colapsado en el piso de 30 minutos teniendo 72 horas por delante. Sin esa cláusula, cerrar un ciclo por "falta mucho para la salida" (§5.5) haría que la corrida siguiente lo reabriera de inmediato: retenciones sobre las tarjetas cada 48 horas, intentos acumulados y emails repetidos.

**Conteo de cupos**, siempre en participantes: `SUM(tickets_adult + tickets_child + tickets_student)`.

| Cohorte     | Qué incluye                                                             | Dónde se usa                                |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| Vendidos    | reservas `pending_minimum` y `pending_payment`, más `capacity_reserved` | disparo de `on_minimum`, `seats_at_trigger` |
| Autorizados | reservas `pending_payment` con `authorized_at`, más `capacity_reserved` | evaluación (§5.3, paso 4)                   |
| Capturados  | reservas `confirmed` de la salida (es lo que suma `capacity_reserved`)  | captura parcial (§5.4)                      |

Una reserva en 3DS (sin `authorized_at`) cuenta como vendida pero no como autorizada.

### 5.3 El ciclo del cobro de una salida

Job nuevo del worker, `charge-departures`, cada minuto. No hay orden entre jobs: cada uno tiene su intervalo y la exclusión es por locks de base de datos.

**Paso 0 — Flag.** No hace nada si `DEFERRED_CHARGE_ENABLED` es falso. Se agrega a `worker/src/env.ts` con default `false`. El flag de la web y el del worker se encienden y se apagan juntos: web encendida con worker apagado significa reservas que nunca se cobran (§11).

**Paso 1 — Selección.** Dos cohortes, ambas con `status <> 'cancelled'`, `starts_at > now()` y **al menos una reserva del flujo diferido** (`payment_method_id IS NOT NULL` en `pending_minimum` o `pending_payment`); esa condición es la que impide tocar salidas del cobro inmediato, donde cancelar por mínimo sería cancelar reservas ya pagadas:

1. **Ciclo por abrir o abierto**: `minimum_resolved_at IS NULL` y `departure_charge_due` verdadero.
2. **Ciclo resuelto con trabajo pendiente**: `minimum_resolution IN ('reached','staff_confirmed')` con capturas pendientes (§5.4) o con reservas `pending_minimum` con tarjeta (las tardías, §5.3 paso 5).

Se toma con `FOR UPDATE SKIP LOCKED` sobre la instancia.

**Paso 2 — Apertura.** Estampa `minimum_charge_triggered_at`, `min_participants_at_trigger`, `seats_at_trigger` y `staff_decision_required_at` (§5.5), limpia `minimum_charge_closed_at` y audita `departure.charge_opened`. Si el ciclo ya está abierto no hace nada (`already_open`); si se está **reabriendo** uno cerrado, vuelve a estampar las cuatro columnas con valores nuevos, porque el plazo se mide desde el disparo.

**No copia el plazo a `bookings.recovery_deadline`**: hacerlo entregaría todas las reservas de la salida al barrido de `watch-charges`, que cancela cualquier `pending_minimum` con el plazo vencido aunque nunca haya fallado. El plazo individual lo sigue fijando `charge_attempt_failed` con `compute_recovery_deadline`, y §5.9 acota ese barrido.

**Paso 3 — Autorización.** Por cada reserva `pending_minimum` con tarjeta guardada y con reintento disponible, que es `(charge_attempts = 0 AND charge_next_attempt_at IS NULL) OR charge_next_attempt_at <= now()`. La distinción importa: `charge_attempt_failed` deja `charge_next_attempt_at` en `NULL` tanto para una reserva que nunca falló como para una que **agotó** sus reintentos; sin el `charge_attempts = 0`, una tarjeta definitivamente rechazada se reconfirmaría cada hora y el turista recibiría un aviso de rechazo cada hora.

1. `charge_booking_start`, como hoy.
2. `POST /payment-intents` con `captureMethod: 'manual'`, y `POST /confirm` con la tarjeta guardada.
3. Resultado: `requires_capture` → `record_authorization`; `requires_action` → `charge_requires_action`; rechazo → `charge_attempt_failed`; `succeeded` (no esperado con captura manual) → se asienta con `confirm_booking`.

**Autorizaciones huérfanas.** Si el worker muere entre el `confirm` y `record_authorization`, la reserva queda `pending_payment` sin `authorized_at` y con una retención viva que nadie reclama. Antes de crear un intent nuevo, el job revisa si la reserva tiene un pago `pending` con intent y lo lee con `GET`: si está en `requires_capture`, lo **adopta** con `record_authorization` en vez de autorizar de nuevo; si está `canceled` o `failed`, lo cierra y sigue. Esa misma lectura es la que hace idempotente al paso 3 ante cualquier caída.

**Paso 4 — Evaluación.** Con los cupos autorizados (§5.2):

- **Alcanzan el mínimo** → se capturan las autorizaciones. Antes de cada `POST /capture` se re-verifica bajo lock que la reserva siga autorizada y sin cancelación en curso (§5.6). Cada captura se asienta con `confirm_booking` **desde su respuesta**, sin depender del webhook, que queda como red (patrón de `worker/src/charges/settle.ts`). La salida se resuelve `reached` **solo cuando todas las capturas llegaron a un estado terminal**.
- **No alcanzan y el plazo no venció** → no se captura ni se suelta nada; las rechazadas siguen su protocolo y en cada corrida se reevalúa.
- **No alcanzan y el plazo venció** → §5.5.

**Paso 5 — Reservas tardías.** Una reserva creada cuando la salida ya está resuelta `reached` o `staff_confirmed` se cobra sola en la corrida siguiente, con captura automática: no hay nada que decidir. Su plazo de recuperación es el de siempre (`compute_recovery_deadline`), no el del ciclo, que ya cerró.

### 5.4 Capturas parciales, caídas y confirmaciones que no confirman

La captura es el único momento en que se mueve plata.

- `minimum_resolved_at` se estampa **después** de que todas las capturas terminaron. Mientras haya pendientes, la salida sigue seleccionable (paso 1, cohorte 2).
- Una captura sin respuesta no se reintenta a ciegas: se relee con `GET`. Si quedó `succeeded`, se asienta; si sigue `requires_capture`, se captura de nuevo.
- Si una captura falla definitivamente, la reserva vuelve a `pending_minimum` con su protocolo:
  - si los **capturados** siguen alcanzando el mínimo, la salida se resuelve `reached`;
  - si caen por debajo, la salida **pasa a la bandeja del staff**, nunca a cancelación automática: ya hay plata cobrada, y cancelar implica reembolsar (§5.5).
- `confirm_booking` después de una captura exitosa puede no dejar la reserva `confirmed`: `overbooked_refunded` (la salida se llenó), `payment_mismatch`, `duplicate_payment`, `ignored` (la fila `pending` ya no está) o `already_processed`. La regla es por descarte: **cualquier outcome que no sea `confirmed` ni `confirmed_unclaimed`** se trata igual, porque en todos la plata ya se capturó. Tratamiento: la reserva **no** cuenta como capturada, el caso se alerta a Sentry con nivel error, y la salida pasa a la bandeja del staff, porque hay plata cobrada que quizá haya que devolver. `overbooked_refunded` ya encola su propio reembolso total.

### 5.5 El plazo y la resolución

```
staff_decision_required_at = LEAST(
  GREATEST(
    LEAST(minimum_charge_triggered_at + MINIMUM_RESOLUTION_WINDOW_HOURS, starts_at - MINIMUM_RESOLUTION_MARGIN_HOURS),
    now() + MINIMUM_RESOLUTION_FLOOR_MINUTES
  ),
  starts_at
)
```

con `MINIMUM_RESOLUTION_WINDOW_HOURS = 48`, `MINIMUM_RESOLUTION_MARGIN_HOURS = 3` y `MINIMUM_RESOLUTION_FLOOR_MINUTES = 30`.

Las 48 horas cubren los tres reintentos y mantienen la autorización dentro del rango confiable (OnvoPay la sostiene 30 días; el emisor puede soltarla antes, 7 días es lo habitual en viajes). El margen de 3 horas evita resolver con la salida encima. **El piso de 30 minutos existe porque `charge_lead_hours` puede ser de 1 hora**: sin él, el plazo nacería vencido y la salida se cancelaría sin un solo intento de cobro. Con plazos cortos hay un intento y ningún reintento; el formulario lo advierte.

Al vencer, con el mínimo sin alcanzar, **primero se sueltan todas las autorizaciones** (`POST /cancel` y `release_departure_authorization`). Después:

| Situación                                                     | Qué pasa                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Falta más de 72 h (`EARLY_CANCEL_FLOOR_HOURS`) para la salida | **No se cancela**: se cierra el ciclo sin resolver con `close_departure_charge`, que estampa `minimum_charge_closed_at`. La salida vuelve a la cola recién cuando falten menos de 72 h (§5.2). Evita avisar de una cancelación con semanas de anticipación. El turista no recibe ningún aviso: su reserva sigue viva y nada cambió para él. |
| Hay alguna reserva ya cobrada (`confirmed`)                   | **Bandeja del staff**, aunque el tour cancele automáticamente: cancelar implica reembolsar plata real.                                                                                                                                                                                                                                      |
| `auto_cancel_below_minimum = true` y sin cobradas             | `auto_cancelled`: se cancelan las reservas sin cobro, la salida queda `cancelled` y se encola `departure_cancelled_minimum`.                                                                                                                                                                                                                |
| `auto_cancel_below_minimum = false`                           | Bandeja del staff.                                                                                                                                                                                                                                                                                                                          |

**Decisión del staff**: confirmar (`staff_confirmed`: la salida vuelve a la cohorte 2 del paso 1 y se autoriza y captura en la corrida siguiente) o cancelar (`staff_cancelled`).

**Red terminal** (decisión del usuario, 2026-09-23): si nadie decide y la salida llega a `starts_at - MINIMUM_RESOLUTION_MARGIN_HOURS`, se cancela sola como `auto_cancelled` y se alerta a Sentry con nivel error. Nadie se presenta a un tour que no va a salir.

**Con plata cobrada, la red terminal no cancela**: alerta con nivel error y deja la salida en la bandeja. Cancelar ahí significa reembolsar sin que nadie lo haya decidido, y el principio de este spec es que ninguna plata se mueve sola en contra del operador. Esto también cubre el caso de un `charge_lead_hours` de 1 o 2 horas, donde el plazo y la red terminal caen casi juntos.

En las dos resoluciones cancelatorias:

- **La salida queda `tour_instances.status = 'cancelled'`.** Si no, sigue reservable en el portal y una reserva nueva caería en el limbo: la salida ya está resuelta, así que ninguna cohorte del paso 1 la levanta.
- **Las reservas `confirmed` reciben reembolso del 100 %** (decisión del usuario) vía la sobrecarga de `cancel_booking` de 6 parámetros de la migración `…046`, con el contrato que ella exige: `p_reason = 'operator_decision'`, `p_fee_cents = 0` y `p_refund_amount_cents = bookings.total_amount_cents` exacto; cualquier otro valor hace fallar la transacción entera con `INVALID_FEE` o `INVALID_REFUND_AMOUNT`. `p_actor_type` es `'system'` en `auto_cancelled` y el rol de quien decidió en `staff_cancelled`, que es también quien queda en `minimum_resolved_by` (lo exige `tour_instances_minimum_actor_check`).
- **Las reservas sin cobro** las cancela una función nueva, `cancel_booking_for_departure`, y no `cancel_unpaid_booking`: esa tiene una lista cerrada de razones donde no entra "mínimo no alcanzado" y, sobre todo, encola `cancellation_confirmation`, que sumada a `departure_cancelled_minimum` le mandaría dos correos al mismo turista por la misma cancelación. La función nueva cancela, libera el hold, cierra el pago y **no** encola nada: el aviso es `departure_cancelled_minimum`.
- `cancel_booking` sí libera cupos y encola su `cancellation_confirmation` para las cobradas, así que `resolve_departure_minimum` no repite ninguna de las dos cosas ni les manda `departure_cancelled_minimum`.

### 5.6 Cancelación con autorización viva

Decisión del usuario (2026-09-23): el turista puede cancelar. El orden importa, porque el job puede estar por capturar esa misma intención:

1. `claim_authorization_cancel(p_booking_id, p_actor_id, p_reason)` toma la reserva con `FOR UPDATE` y estampa `cancel_claimed_at`. Outcomes: `claimed`, `capture_in_progress` (el job estampó `capture_started_at`: la UI pide reintentar en unos minutos), `not_authorized` (sigue el camino de hoy) o `not_cancellable`.
2. Con `claimed`, el llamador suelta la autorización en OnvoPay. Si el `POST /cancel` falla, la marca se libera y se responde el error genérico: se reintenta.
3. `cancel_authorized_booking` cierra el pago y deja la reserva `cancelled`.

Del otro lado, el job estampa `capture_started_at` bajo lock inmediatamente antes de cada `POST /capture`, y no captura una reserva con `cancel_claimed_at`. Las dos marcas son el mecanismo de exclusión: ninguna de las dos operaciones puede sostener un lock de fila durante una llamada HTTP, que es algo que el repo evita a propósito.

**Marcas vencidas.** Si el proceso que reclamó muere, la reserva quedaría reclamada para siempre. `watch-charges` suma un barrido: un `cancel_claimed_at` de más de 15 minutos se limpia (el turista puede volver a intentar) y un `capture_started_at` de más de 15 minutos se resuelve leyendo la intención con `GET`, como el resto de los casos ambiguos.

**Recuento después del descarte.** El paso 4 vuelve a contar los cupos autorizados **después** de descartar las reservas reclamadas. Si con ese descarte la salida deja de alcanzar el mínimo, no se captura nada: se trata como el caso de "no alcanzan" (§5.3, paso 4). Capturar a los demás dejaría plata cobrada en una salida que ya no sale.

### 5.7 Un 3DS en vuelo cuando hay que resolver

Una reserva que quedó en `requires_action` tiene un intent vivo que **no** es una autorización: soltar autorizaciones no la cubre, `cancel_unpaid_booking` la rechaza con `charge_in_flight` y `cancel_charge_in_flight` solo actúa con el plazo invocado ya vencido. Si se la deja, el turista puede completar el 3DS después de que la salida se canceló, y el cobro entra como pago tardío con su reembolso.

Tratamiento: al resolver la salida, **antes** de cancelar nada, el job cancela en OnvoPay los intents en `requires_action` de la salida (la API lo permite sobre ese estado, verificado en el spec 0029) y usa `cancel_charge_in_flight` con la razón `action_expired`, que para eso existe. Solo después se resuelve el mínimo.

### 5.8 Constraint que hay que cambiar

`tour_instances_minimum_trigger_check` de `…043` dice hoy:

```sql
(minimum_charge_triggered_at IS NOT NULL) = COALESCE(minimum_resolution IN ('reached','staff_confirmed'), false)
```

Es una equivalencia bidireccional: **con ella, estampar el disparo antes de resolver es imposible**, y el estado "en cobro" no existiría. Se reemplaza por la implicación:

```sql
minimum_resolution NOT IN ('reached','staff_confirmed') OR minimum_charge_triggered_at IS NOT NULL
```

El invariante que se pierde ("no hay disparo sobre una salida cancelada") se reemplaza por otro, más débil y correcto: **el disparo es evidencia de que hubo un ciclo, no autorización para cobrar**; lo que autoriza a capturar es la evaluación del mínimo, no la columna. Los otros tres CHECKs se conservan: par resolución/fecha, snapshot obligatorio junto al disparo y actor solo en resoluciones del staff. El `DROP`/`ADD` se aplica sobre datos donde todas esas columnas son `NULL`, así que valida al instante.

### 5.9 Lo que cambia del código existente

Con una autorización viva durante horas, una `pending_payment` deja de ser un cobro en vuelo de segundos:

- **`watch-charges`**: `IntentStatus` no conoce `requires_capture`. Se agrega, con acción "esperar" en `decideInFlight` y **"cancelar" en `decideSweep` y `decideUnpaidCancel`**: una autorización huérfana (de una reserva cancelada o fallada cuyo release no llegó a ejecutarse) tiene que soltarse, no alertar. `isConfirmable` lo trata como cancelable.
- **Barrido de plazos vencidos** (`fetchExpiredRecoveries`): se acota a reservas con `charge_attempts > 0`. Hoy cancelaría cualquier `pending_minimum` con `recovery_deadline` vencido aunque nunca haya fallado, y ese job **no** está detrás del flag.
- **Barrido de cobros en vuelo** (`fetchInFlightCharges`): excluye reservas con `authorized_at`, que tienen su propio plazo. La red terminal de salidas ya empezadas (`fetchStartedUnpaid`) sí las incluye: hoy solo mira `pending_minimum`, y una reserva autorizada que llegó a la hora de salida tiene que soltarse y cancelarse, no quedarse con la retención viva.
- **Cancelación del turista y del panel**: §5.6.
- **Archivado de tours**: suma el bloqueo con salidas en cobro.

### 5.10 Funciones SQL nuevas

Con el patrón del repo: `SECURITY DEFINER`, `search_path = ''`, guard `is_public_request()`, `REVOKE` a `PUBLIC, anon, authenticated`, `GRANT EXECUTE` a `service_role`, y auditoría de cada transición.

| Función                                        | Devuelve                                                                      | Audita                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| `departure_charge_due(uuid)`                   | `boolean`                                                                     | —                               |
| `departure_seat_counts(uuid)`                  | `jsonb` con `sold`, `authorized`, `captured`, `minimum`                       | —                               |
| `open_departure_charge(uuid)`                  | `'opened' \| 'already_open' \| 'not_due' \| 'not_chargeable'`                 | `departure.charge_opened`       |
| `record_authorization(uuid, text)`             | `boolean`                                                                     | `charge.authorized`             |
| `release_departure_authorization(uuid, text)`  | `boolean`                                                                     | `charge.authorization_released` |
| `cancel_booking_for_departure(uuid, text)`     | `'cancelled' \| 'not_cancellable'`                                            | `booking.cancelled`             |
| `close_departure_charge(uuid)`                 | `boolean`                                                                     | `departure.charge_closed`       |
| `resolve_departure_minimum(uuid, text, uuid)`  | `'resolved' \| 'already_resolved' \| 'invalid_resolution'`                    | `departure.minimum_resolved`    |
| `claim_authorization_cancel(uuid, uuid, text)` | `'claimed' \| 'capture_in_progress' \| 'not_authorized' \| 'not_cancellable'` | —                               |
| `cancel_authorized_booking(uuid, uuid, text)`  | `'cancelled' \| 'not_claimed'`                                                | `booking.cancelled`             |

`release_departure_authorization` **cierra la fila `pending` de `payments`** (como hace `close_pending_payment`) además de limpiar `authorized_at`, `charge_started_at`, `awaiting_action_until` y `recovery_deadline`. Sin cerrar el pago, la corrida siguiente crearía un intent nuevo y `charge_booking_start` devolvería `intent_mismatch` para siempre; sin limpiar `charge_started_at`, el reintento chocaría con la separación mínima de una hora. `charge_booking_start`, `charge_attempt_failed`, `charge_requires_action` y `confirm_booking` no cambian.

### 5.11 Cliente de OnvoPay

El cliente del worker suma `createIntent` (con `captureMethod`), `confirmIntent` (con la lectura defensiva del adapter web: un `400` se relee con `GET`) y `captureIntent`. `cancelIntent` ya existe. En el adapter web, `createPaymentSession` acepta `captureMethod` opcional y se agrega `capturePaymentIntent`, sin cambiar el cobro manual.

### 5.12 Panel, textos y legales

- **Formulario del tour**: "¿Cuándo se cobra?" con las dos opciones, y horas visibles solo con "antes de la salida", con el valor global como marcador y el aviso de los plazos cortos.
- **Configuración**: campo para `default_charge_lead_hours`.
- **Salida**: estado del cobro, cupos autorizados contra el mínimo y plazo.
- **Bandeja de decisión**: `/dashboard/departures` ya existe, con la asignación de guías del spec 0009. La bandeja se integra ahí como una sección propia arriba de la tabla, con las salidas que esperan decisión y botones de confirmar o cancelar, y el estado del cobro se muestra en cada fila de la tabla existente. Admin y staff.
- **Email `departure_cancelled_minimum`** (el `kind` ya existe desde `…043`, sin plantilla): ES y EN. Dice que la salida no alcanzó el mínimo, que **no se hizo ningún cobro** y que, si hubo retención, puede tardar unos días en desaparecer del estado de cuenta.
- **Términos**: el turista tiene que saber que al cobrar se retiene el monto. Decisión del usuario (2026-09-23): va en el cuerpo de los términos (`terms-body` en `es.json` y `en.json`) con bump de `TERMS_VERSION`. **`REFUND_FEE_FROM_TERMS_VERSION` sigue en `null`**: subir la versión de términos no activa la política del spec 0032, que además espera la validación de la abogada. `docs/lanzamiento-checklist.md` acopla los dos cambios en un mismo deploy y hay que desacoplarlos explícitamente ahí.

## 6. Modelo de datos

- **Tabla** `tours`: alter. `charge_timing`, `charge_lead_hours` (§5.1).
- **Tabla** `business_settings`: alter. `default_charge_lead_hours` con su grant (§5.1).
- **Tabla** `bookings`: alter. `authorized_at timestamptz NULL`, `cancel_claimed_at timestamptz NULL` y `capture_started_at timestamptz NULL` (§5.6), las tres con CHECK de que solo existen sobre `pending_payment` o `confirmed`, al estilo de los CHECKs de `…043`. `authorized_at` se limpia solo al soltar la autorización, no al capturar: el estado se deriva de `bookings.status` y `payments.status`, y limpiarla abriría una ventana donde la reserva no cuenta ni como autorizada ni como confirmada.
- **Tabla** `tour_instances`: alter. `minimum_charge_closed_at timestamptz NULL` (§5.1) y el CHECK de §5.7.
- **Funciones**: las nueve de §5.9.
- **Índices**: `tour_instances_minimum_unresolved_idx` de `…043` cubre la primera cohorte del paso 1 (salidas sin resolver), pero **no la segunda**, que son salidas ya resueltas con trabajo pendiente. Esa se busca desde las reservas, con `bookings_pending_minimum_instance_idx` de `…043`, como advierte el comentario de esa misma migración. No hace falta ningún índice nuevo.
- **Migración**: `supabase/migrations/20260924000047_cobro_automatico_minimo.sql`, después de la `…046`.
- **Tipos**: actualizar a mano `web/types/database.ts`.

## 7. Estados y transiciones

| Estado de la salida  | Cómo se reconoce                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Sin cobrar           | sin disparo y sin resolver                                                                                    |
| En cobro             | disparo estampado, `minimum_resolved_at IS NULL`                                                              |
| Cerrada sin resolver | `minimum_charge_closed_at` estampado, con disparo, foto y plazo limpios (la reapertura los vuelve a estampar) |
| Esperando decisión   | en cobro, con `staff_decision_required_at <= now()`                                                           |
| Resuelta             | `minimum_resolved_at` con una de las cuatro resoluciones                                                      |

De la reserva, sin estados nuevos: `pending_minimum → pending_payment` al autorizar (con `authorized_at`), y de ahí a `confirmed` al capturar, o de vuelta a `pending_minimum` al soltar o al fallar.

## 8. Casos borde y errores

- **Salida del flujo inmediato**: el job no la selecciona. Sin esa condición cancelaría reservas ya pagadas.
- **Salida mixta** (reservas inmediatas confirmadas más diferidas): se selecciona, y como hay cobradas, toda cancelación pasa por la bandeja del staff.
- **Plazo que nacería vencido** (`charge_lead_hours` de 1 o 2 h): el piso de 30 minutos garantiza al menos un intento (§5.5).
- **Reserva con reintentos agotados**: no se reautoriza ni genera más avisos (§5.3, paso 3).
- **Ciclo cerrado por lejanía**: no se reabre hasta que falten 72 h (§5.2). Sin esa marca, el ciclo se reabriría cada minuto.
- **Una autorización vence antes de capturar**: la captura falla y se trata como rechazo (§5.4).
- **Captura exitosa que no confirma**: alerta y bandeja del staff (§5.4).
- **3DS**: no cuenta como autorizada hasta que el turista confirme.
- **Caída del worker en medio del ciclo**: al volver se releen las intenciones con `GET`.
- **Carrera entre cancelar y capturar**: resuelta por el claim (§5.6).
- **Dos corridas simultáneas**: `FOR UPDATE SKIP LOCKED` sobre la instancia y los gates de estado de cada reserva.
- **Nadie decide**: red terminal a `starts_at - 3 h` (§5.5).
- **El tour cambia de `charge_timing` con un ciclo abierto**: el ciclo termina con la regla con la que se abrió.
- **Sin ninguna reserva con tarjeta**: no se abre ciclo; la salida se cancela por el camino normal cuando corresponda.
- **Autorización huérfana** (caída entre confirmar y registrar): se adopta leyendo la intención (§5.3, paso 3).
- **Reserva reclamada para cancelar que hundía el mínimo**: no se captura nada (§5.6).
- **3DS en vuelo al resolver**: se cancela el intent antes de resolver (§5.7).
- **Salida cancelada por mínimo**: queda `cancelled`, así que no admite reservas nuevas.
- **Marca de claim o de captura vencida**: se limpia o se resuelve leyendo la intención (§5.6).
- **Flujo diferido apagado**: el job no corre.

## 9. Impacto en otras áreas

- **Worker**: job nuevo; flag en `env`; cliente de OnvoPay con crear, confirmar y capturar; `watch-charges` con `requires_capture` y los dos barridos acotados (§5.8).
- **Web**: cancelación con autorización viva, archivado de tours, adapter con `captureMethod` y captura.
- **Panel**: formulario del tour, configuración, estado de la salida y bandeja.
- **Emails**: plantilla `departure_cancelled_minimum`.
- **Legal**: cuerpo de términos y bump de `TERMS_VERSION`, con revisión de la abogada; desacoplar el checklist de la activación del 0032 (§5.12).
- **Reportes y retención**: sin cambios.
- **Documentación**: `docs/cutover-produccion.md`, `docs/lanzamiento-checklist.md` (incluido el paso 7, que hoy manda reemplazar `terms-body` entero: el texto de la abogada tiene que incorporar la cláusula de la retención, si no se pierde en silencio), `docs/roadmap.md` (este spec revierte una decisión de diseño del 0029), el changelog del 0029 y `decisions.md`, donde ya está la entrada del 2026-09-23.

## 10. Plan de tests

- **Unit (worker)**: decisión del ciclo (`capture | wait | release | close`) con cupos por debajo, en el mínimo y por encima; plazo vencido y sin vencer; con y sin reservas cobradas; lejos y cerca de la salida. `decideInFlight`, `decideSweep` y `decideUnpaidCancel` con `requires_capture`.
- **Unit (plantilla)**: `departure_cancelled_minimum` en ES y EN, con el texto de que no hubo cobro y el de la retención.
- **Integración (SQL)**: `departure_charge_due` en las dos modalidades, con y sin `charge_lead_hours`, con el respaldo de `on_minimum` y con el ciclo cerrado (no reabre antes de 72 h); `departure_seat_counts` con 3DS y con confirmadas; `open_departure_charge` (idempotente, snapshot, plazo con su piso); `record_authorization`; `release_departure_authorization` (limpia `charge_started_at`); `close_departure_charge`; `resolve_departure_minimum` con las cuatro resoluciones, verificando cupos liberados una sola vez, reembolsos del 100 % que respetan los invariantes de `cancel_booking` de `…046`, un solo email por reserva y los cuatro CHECKs de `tour_instances`; `claim_authorization_cancel` y `cancel_authorized_booking` con sus outcomes; permisos de las nueve funciones.
- **Integración (worker, OnvoPay simulado)**: salida que alcanza el mínimo; salida que no (no captura, espera, suelta, cancela); la misma sin cancelación automática; rechazada que carga otra tarjeta y completa el mínimo; captura parcial fallida por encima y por debajo del mínimo; caída entre capturas; `confirm_booking` que devuelve `payment_mismatch` tras capturar; reserva tardía; dos corridas simultáneas; salida del flujo inmediato intacta; reintentos agotados que no reautorizan; `on_minimum` lejos de la salida que cierra y no reabre; red terminal sin decisión del staff; barrido de plazos vencidos que no cancela reservas sin intentos.
- **Integración (web)**: el turista cancela con autorización viva; el claim rechaza cuando la captura está en curso; el formulario guarda las dos opciones y el plazo.
- **Integración (worker)**, casos de esta ronda: autorización huérfana adoptada sin crear un intent nuevo; reserva reclamada que hunde el mínimo y frena todas las capturas; 3DS en vuelo cancelado antes de resolver; salida resuelta que queda `cancelled` y no admite reservas nuevas; ciclo reabierto con plazo y foto nuevos; red terminal que **no** cancela cuando hay plata cobrada; marcas de claim y de captura vencidas; una sola notificación por reserva en cada resolución.
- **Manual (en el PR)**: con llaves de prueba, una salida con mínimo 2 y una tarjeta que falla: verificar en el dashboard de OnvoPay que la autorización se soltó y que no quedó ningún costo.

## 11. Plan de rollout

- **Detrás de `DEFERRED_CHARGE_ENABLED`**, apagado en producción: el cambio llega inerte. Los dos flags (web y worker) se encienden y se apagan juntos.
- **Orden**: migración `…047` antes del código.
- **Datos existentes**: los tours quedan en `before_departure` sin plazo propio; las salidas en curso no tienen ciclo abierto.
- **`TERMS_VERSION`** se sube en este deploy; `REFUND_FEE_FROM_TERMS_VERSION` sigue en `null` (§5.12).
- **Antes de encender el flujo diferido** (ya en el checklist): prueba de 30 días con tarjeta real, worker always-on y alerta de liveness. Se suma una **prueba de autorización y soltado en modo live**, y medir cuánto tarda el banco en liberar la retención, para el texto del email.
- **Reversión**: apagar el flag detiene el motor. Como las autorizaciones vivas no pueden quedar a la deriva, se incluye un modo "soltar todo" del job, invocable con una variable de entorno propia (funciona con el flag apagado): suelta las autorizaciones de las salidas en cobro y cierra sus ciclos.

## 12. Métricas de éxito

- Cero costos de procesamiento pagados por salidas canceladas por mínimo.
- Cero capturas sobre salidas que no alcanzaron el mínimo.
- Cero salidas que llegan a su fecha con el mínimo sin resolver.
- Cero autorizaciones vivas con más de 50 horas.
- Mediana menor a 2 minutos entre el disparo y la resolución, cuando no hay rechazos.

## 13. Preguntas abiertas

Ninguna bloquea la implementación; todas bloquean **encender el flujo diferido**, que ya estaba bloqueado por la prueba de 30 días.

- [ ] **Pregunta**: ¿los montos fijos de la tarifa se cobran por autorización o solo por captura? En sandbox una autorización soltada no dejó transacción de balance. **Dueño**: Kenneth. **Antes de**: 2026-10-31.
- [ ] **Pregunta**: ¿cuánto tarda el banco del turista en soltar una autorización cancelada? Define el texto del email. **Dueño**: Kenneth (prueba con tarjeta real). **Antes de**: 2026-10-31.
- [ ] **Pregunta**: ¿el texto de la retención en los términos cumple con lo que espera la abogada? **Dueño**: Dra. Xinia Guerrero. **Antes de**: 2026-10-31.

## 14. Notas de implementación (2026-09-23)

Lo que la implementación resolvió distinto de lo escrito arriba, después de la ronda de revisión:

- **El plazo se espera completo aunque ninguna reserva tenga reintentos por delante**: hasta que
  venza pueden entrar reservas nuevas, que es para lo que existe la ventana.
- **Después del plazo no se autoriza nada más.** Sin ese corte, una salida esperando decisión del
  staff volvía a autorizar y soltar cada minuto, reteniéndole plata al turista una y otra vez.
- **§5.7 (3DS en vuelo) se resuelve dentro del soltado**: `releaseAll` cancela en la pasarela
  cualquier intent que no haya cobrado, incluido el de `requires_action`, y
  `release_departure_authorization` lo asienta. No se usa `cancel_charge_in_flight` con
  `action_expired`, que exige el plazo del 3DS ya vencido.
- **Los plazos de 72 h y 3 h están espejados en el worker** además de en la SQL, porque las
  decisiones de capturar, soltar y cancelar se toman ahí. Es una desviación consciente de §5.1.
- **`resolve_departure_minimum` suma el outcome `capture_in_progress`**: no resuelve mientras el
  worker esté capturando una reserva de la salida.
- **`charge_attempt_failed` y `cancel_charge_in_flight` de la …044 se reemplazan** para limpiar
  las marcas de la autorización al salir de `pending_payment`.
