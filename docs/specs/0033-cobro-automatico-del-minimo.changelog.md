# Changelog — 0033 Cobro automático del mínimo

Spec: [0033-cobro-automatico-del-minimo.md](./0033-cobro-automatico-del-minimo.md)
Rama: feat/0033-cobro-automatico-minimo

## 2026-10-02 — Decide el staff, con el aviso de 24 horas, y latido del worker

**Hecho**:

- **El motor nunca cancela ni confirma solo una salida bajo el mínimo** (decisión del usuario).
  Al vencer el plazo suelta las retenciones y la salida pasa a la bandeja de Salidas; el staff
  la confirma (se cobra a todos) o la cancela. El motor deja de leer
  `tours.auto_cancel_below_minimum`, que el formulario ya no ofrecía desde el spec 0035 (la
  columna queda sin uso). Se elimina la red terminal que cancelaba sola a 3 horas de la salida.
- **El plazo del ciclo vence 30 horas antes de la salida** (migración `…055`), no 3. Los términos
  prometen avisar la cancelación por mínimo con 24 horas; en la prueba en producción el motor
  canceló a las 13:00 una salida de las 16:00. Las 30 horas le dejan al staff 6 para decidir
  antes de ese límite. El plazo de cobro tiene un piso de 32 horas (`departure_charge_due` y la
  validación del panel); el aviso de plazo corto pasa a 38.
- **`resolve_departure_minimum` no cancela por mínimo con menos de 24 horas**: devuelve
  `minimum_too_late`, la misma regla que `cancel_departure` ya tenía para el cobro inmediato. La
  bandeja lo explica y el staff que igual quiera cancelar elige otra causa.
- **Alertas de la bandeja, una por salida**: espera decisión (warning), plata cobrada bajo el
  mínimo o ya tarde para cancelar por mínimo (error).
- **Los correos y las páginas de tarjeta rechazada y de 3DS muestran el plazo real**: el menor
  entre el de la reserva y el del ciclo abierto de la salida.
- **Latido del worker** (`worker/src/liveness.ts`, lo exigía el spec 0029 §11): cada ciclo de
  `watch-charges` manda un check-in al monitor `worker-cobros` de Sentry, que alerta cuando faltan
  dos seguidos.

**Por qué / decisiones**:

- Decisiones del usuario (2026-10-02): alinear el motor con el aviso de 24 horas de los términos,
  y que si una salida se hace o se cancela lo decida siempre una persona.
- El CSP sigue bloqueando los tres dominios de antifraude del SDK de OnvoPay (decisión del
  usuario): permitirlos manda la IP y la huella del visitante a terceros y contradice el aviso de
  privacidad. Se revisa con los datos de la fase 6b.
- El plazo de 30 horas es un valor elegido, no una exigencia legal: 24 de aviso más 6 para
  decidir. Vive en `open_departure_charge` (…055) y se refleja en los textos del panel.

**Riesgo aceptado**: si nadie decide en la bandeja, las reservas sin cobrar de esa salida se
cancelan a la hora de la salida (`watch-charges`), y el turista se entera ahí. Las alertas a
Sentry son la red para que eso no pase.

**Pendiente**:

- `business_settings.minimum_decision_window_hours` sigue llamándose "ventana de decisión" en el
  panel, aunque hoy solo fija el plazo de recuperación de un cobro rechazado. Se corrigió la
  ayuda; el nombre del campo queda.
- El cobro inmediato (`resolve-minimum`, spec 0035) sigue cancelando solo, un día antes, las
  salidas bajo el mínimo sin reservas diferidas.

## 2026-10-01 — Arreglos tras la prueba en producción (modo prueba de OnvoPay)

Primera corrida del motor contra producción, con plazos comprimidos. Pasaron: reserva sin cobro,
autorización al llegar el plazo, captura al alcanzar el mínimo, soltado y cancelación al no
alcanzarlo, 3DS y cancelación antes del cobro. Fallaron dos caminos, que se arreglan acá.

**Hecho**:

- **El reintento de una reserva rechazada no ocurría nunca** (`departure-authorize.ts`). Un rechazo
  deja el intent en `requires_payment_method` con su pago `pending`; el motor creaba un intent
  nuevo, `charge_booking_start` respondía `intent_mismatch` y lo cancelaba en silencio, cada
  minuto. El turista cambiaba la tarjeta y no se le cobraba. Ahora cancela el intent rechazado y
  cierra su pago antes de crear el nuevo (spec 0029 §5.6). Los tests existentes simulaban el
  rechazo con `failed` (terminal), por eso no lo cazaban; se agrega el caso no terminal.
  Verificado en producción: tras el cambio de tarjeta, la reserva se autorizó sola al vencer la
  hora.
- **Cancelar con la autorización viva no era alcanzable desde ninguna pantalla** (§5.6). La página
  del turista y el panel trataban toda `pending_payment` con cobro iniciado como cobro en curso.
  La vista ahora distingue `authorizationHeld`; el turista ve "Reservada, con el monto retenido" y
  puede cancelar, y el panel muestra "Autorizada (monto retenido)" con su botón de cancelar.
- **"Volver a cobrar" del panel sobre un intent de captura manual** devolvía `requires_capture`,
  que el cobro manual no conocía: mostraba "revisión manual" y alertaba. Ahora registra la
  autorización (`record_authorization`) y responde `authorized`; la captura la hace el worker.
- **Motor apagado con reservas esperando**: con la web vendiendo en diferido y el flag del worker
  apagado, las reservas se cancelaban solas a la hora de salida sin ningún aviso. El job alerta a
  Sentry (una vez por proceso) y el worker escribe al arrancar el estado del flag.

**Ronda de revisión** (payment-flow-auditor, sin bloqueantes ni caminos de doble cobro). Lo que
señaló y se corrigió antes del push:

- **Ni el motor ni el cobro manual reconfirman el intent que dejó un rechazo: lo reemplazan.** El
  motor crea intents de captura manual y el cobro manual del panel, de captura automática;
  reconfirmar uno ajeno cobraría antes de decidir el mínimo, o dejaría una retención sin ciclo que
  la capture. La primera versión leía `captureMethod` del GET para decidir, como dice el OpenAPI,
  pero **OnvoPay no devuelve ese campo** (verificado contra producción el 2026-10-01). Cada lado
  cancela el intent retenido, cierra su pago y crea uno propio. El cobro manual respeta antes la
  hora mínima entre intentos, para no cancelar nada si igual no va a cobrar.
- **Un intent ya cobrado sobre una `pending_minimum`** (webhook perdido) se asienta en el acto:
  nadie más miraba esa reserva hasta su plazo y mientras tanto no contaba para el mínimo.
- **`processing` tras el confirm ya no se registra como rechazo**: le avisaba "tarjeta rechazada"
  a un turista cuyo cobro todavía podía entrar.
- **Cancelar con la autorización viva es idempotente**: si soltar falla porque el intent ya está
  cancelado, se da por soltada y la cancelación sigue.

**Pendiente** (hallazgos de la misma prueba, sin arreglar):

- El CSP bloquea `api.ipify.org`, `api.my-ip.io` y `h.online-metrix.net`, que usa el SDK de
  OnvoPay en la página de 3DS (señales antifraude). Decidir si se permiten antes del modo live.
- Los correos de rechazo y de 3DS prometen el plazo de recuperación (24 h antes de la salida), que
  puede ser posterior al plazo del ciclo, cuando la salida se suelta y se cancela.
- El formulario del tour no tiene vigencia de horario ni el interruptor de cancelación automática.

## 2026-09-23 — Implementación completa

**Hecho**:

- **Migración `…047`**:
  - `tours.charge_timing` (`on_minimum` | `before_departure`) y `tours.charge_lead_hours`;
    `business_settings.default_charge_lead_hours` (48 por defecto).
  - `bookings.authorized_at`, `cancel_claimed_at` y `capture_started_at`, con
    `bookings_authorization_state_check`.
  - `tour_instances.minimum_charge_closed_at`: un ciclo cerrado sin resolver (salida lejana) que
    no se reabre cada minuto.
  - `tour_instances_minimum_trigger_check` pasa de equivalencia a implicación: con la
    equivalencia, el estado "en cobro" era imposible de representar.
  - Diez funciones nuevas: `departure_seat_counts`, `departure_charge_due`,
    `open_departure_charge`, `close_departure_charge`, `record_authorization`,
    `release_departure_authorization`, `claim_authorization_cancel`,
    `cancel_authorized_booking`, `cancel_booking_for_departure` y `resolve_departure_minimum`.
  - `cancel_charge_in_flight` de la `…044` se reemplaza para que limpie las marcas de la
    autorización.
- **Worker**:
  - Job `charge-departures`, cada minuto, detrás de `DEFERRED_CHARGE_ENABLED`, con
    `RELEASE_AUTHORIZATIONS_ONLY` como marcha atrás.
  - Cliente de OnvoPay: `createManualCaptureIntent`, `confirmIntent` y `captureIntent`.
  - Decisiones puras en `departure-cycle.ts` (capturar / esperar / soltar, y qué pasa después de
    soltar), y el resto repartido por responsabilidad para respetar el límite de líneas:
    `departure-repository.ts` (lecturas), `departure-rpc.ts` (transiciones),
    `departure-authorize.ts`, `departure-settle.ts` y `departure-resolve.ts`.
  - `watch-charges`: `requires_capture` deja de ser un estado inesperado; el barrido de plazos
    vencidos se acota a las reservas que ya fallaron; el de cobros en vuelo excluye las
    autorizadas; y la red terminal de salidas empezadas sí las incluye y las suelta.
  - Email `departure_cancelled_minimum` (ES y EN), con el texto de la retención.
- **Web**:
  - Formulario del tour: "¿Cuándo se cobra?" con el plazo propio y el aviso de plazos cortos.
  - Configuración: `default_charge_lead_hours`.
  - Panel de salidas: estado del cobro por salida y bandeja de decisión con confirmar y cancelar.
  - Cancelación con una autorización viva (`cancel-authorized.ts`): reclamo, soltada en la
    pasarela y recién después la cancelación.
  - Archivado de tours: se bloquea con una salida en pleno ciclo de cobro.
- **Legales**: cláusula de la retención en `terms-body` (ES y EN) y `TERMS_VERSION` a
  `2026-09-23`. `REFUND_FEE_FROM_TERMS_VERSION` sigue en `null`, y el checklist de lanzamiento
  ahora dice explícitamente que los dos cambios están desacoplados.
- **Tests**: 26 unitarios nuevos del ciclo y de los reintentos, 19 de integración del motor
  contra la base real con OnvoPay simulado, 11 de la cancelación con autorización viva y de la
  decisión del staff, los permisos de las doce funciones nuevas en `rpc-execute-grants`, más los
  del formulario, la configuración y el email. Totales al cerrar: worker 237 unitarios y 88 de
  integración; web 371 y 525.

- **Prueba manual** (Supabase local, web en el puerto 3100): con una salida de prueba con el ciclo
  abierto y el plazo vencido, la bandeja apareció arriba de la tabla, la columna "Cobro" mostró
  "Espera decisión · 0 de 4 cupos", y confirmar dejó la salida en "Confirmada por el staff" y
  sacó la fila de la bandeja. Los datos de prueba se borraron.

**Ronda de revisión** (db-schema-guardian, payment-flow-auditor y code-reviewer). Lo que
encontraron y se corrigió, todo antes del PR:

- **La captura que no confirma abortaba la transacción con la plata ya cobrada.** El CHECK nuevo
  dejaba fuera `payment_mismatch` y `overbooked_refunded`, y `charge_attempt_failed` devolvía la
  reserva a `pending_minimum` sin limpiar las marcas. Se amplió el CHECK y se reemplazó
  `charge_attempt_failed` para que las limpie.
- **Rotación infinita de autorizaciones mientras la salida espera decisión**: con el plazo vencido
  el job volvía a autorizar cada minuto, reteniéndole plata al turista una y otra vez. Ahora no se
  autoriza nada después del plazo.
- **El motor tocaba reservas del cobro inmediato** en una salida mixta: les cancelaba el intent al
  turista que estaba pagando. Las lecturas del ciclo ahora exigen tarjeta guardada.
- **Un `cancel` fallido en la pasarela se registraba como soltado y cerrado**, dejando una
  retención viva invisible y habilitando una segunda. Ahora solo se marca soltada cuando la
  pasarela confirma.
- **Una cancelación reclamada no frenaba las capturas del resto**: se recuenta justo antes de
  capturar y, si la salida deja de alcanzar el mínimo, no se captura nada.
- **La decisión del staff podía cancelar con una captura en curso**: `resolve_departure_minimum`
  devuelve `capture_in_progress` y el panel pide reintentar.
- **La server action no validaba sus entradas**: cualquier valor distinto de `confirm` caía en la
  rama que cancela la salida y reembolsa. Ahora valida con Zod.
- **Las doce funciones nuevas no estaban en el test de permisos**, que es la regresión del
  hallazgo crítico de la 2ª auditoría.
- Otros: `processing` dejó de tratarse como rechazo terminal; se adoptan de verdad las
  autorizaciones huérfanas y se cierran los intents muertos; la marca de captura exige que no
  haya otra en curso; el reclamo de cancelación se audita; la foto de cupos se toma antes de
  cancelar; el panel descarta las reclamadas igual que la SQL; el intent se lee después del
  reclamo; `SET LOCAL lock_timeout`; y un CHECK nuevo para el par ciclo cerrado / disparado.

**Por qué / decisiones**:

- **Autorizar y capturar, no cobrar directo**: verificado en el sandbox de OnvoPay (2026-09-23)
  que cancelar una autorización no deja transacción de balance, y que capturar cuesta la comisión
  más el IVA. Es lo que elimina el caso que originó el spec: tres tarjetas cobradas en una salida
  que igual se cancela por no llegar al mínimo.
- **Se espera al plazo completo aunque ninguna reserva tenga reintentos por delante**: la primera
  versión soltaba antes, y eso le quitaba a la salida la chance de llegar al mínimo con reservas
  nuevas. La ventana existe justamente para eso (§5.3, paso 4).
- **El barrido de plazos vencidos de `watch-charges` se acota a `charge_attempts > 0`**: ese job
  no está detrás del flag, y el plazo solo lo estampa un rechazo.
- **La red terminal cancela por `cancel_charge_in_flight`, no por `cancel_unpaid_booking`**: esa
  última solo acepta `pending_minimum`, y una reserva autorizada ya es `pending_payment`.
- **El disparo del ciclo es evidencia, no autorización para cobrar**: lo que habilita a capturar
  es la evaluación del mínimo. Por eso el CHECK pasó a implicación.

**Pendiente**:

- Anotado y fuera de alcance de esta ronda: el `FOR UPDATE SKIP LOCKED` por salida del §5.3 (hoy
  la exclusión es el guard de proceso más los gates por reserva), las alertas de plata retenida
  solo van a Sentry y no a `audit_logs`, y el modo de reversión no alcanza salidas ya empezadas o
  canceladas.
- Los plazos de 72 h y 3 h quedaron espejados en el worker (`departure-cycle.ts`,
  `departure-resolve.ts`) además de en la SQL, contra lo que decía §5.1: las decisiones de
  capturar, soltar y cancelar se toman en el worker. Si cambia uno hay que cambiar los dos.
- Casos del §10 que faltan como test de integración: dos corridas simultáneas, ciclo reabierto
  con plazo y foto nuevos, y marcas vencidas end-to-end.
- Antes de sumar PayPal: el modelo asume tres propiedades de OnvoPay (captura manual, soltar
  gratis, `requires_capture → succeeded`) que no están declaradas en ninguna interfaz.
- Confirmar en modo vivo, antes de encender `DEFERRED_CHARGE_ENABLED` en producción, si las
  comisiones fijas se cobran por autorización y cuánto tarda cada banco en soltar una retención
  cancelada.
- PR (lo mergea el usuario).
