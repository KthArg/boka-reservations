# Changelog — 0033 Cobro automático del mínimo

Spec: [0033-cobro-automatico-del-minimo.md](./0033-cobro-automatico-del-minimo.md)
Rama: feat/0033-cobro-automatico-minimo

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
