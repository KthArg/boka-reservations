# Changelog — 0029 Cupo mínimo y cobro diferido

Spec: [0029-cupo-minimo-y-cobro-diferido.md](./0029-cupo-minimo-y-cobro-diferido.md)
Rama: feat/0029-cupo-minimo-config (workstream A), feat/0029-cobro-diferido (workstream B)

## 2026-09-16 16:30 — Workstream B, unidad 3b: cobro manual, cambio de tarjeta y 3DS

**Hecho**:

- **Cobro manual del panel** ("Cobrar ahora" / "Volver a cobrar", `lib/booking/manual-charge*.ts`):
  - GET del intent retenido antes de re-confirmar. `succeeded` se asienta sin re-confirmar; `processing` o `requires_action` esperan con alerta; solo `canceled` o `failed` habilitan un intent nuevo, tras `close_pending_payment`.
  - Inicio bajo lock con `charge_booking_start`. Si el inicio no arranca, el intent recién creado se cancela y un cancel fallido alerta. Un error ambiguo de la RPC se relee antes de cancelar.
  - Un confirm sin respuesta queda en vuelo para `watch-charges`. El resultado se registra por status con las funciones del worker.
  - Todo camino a "revisión manual" alerta a Sentry con nivel error.
- **Cambio de tarjeta** (`/booking/[token]/card`):
  - Mismas reglas que el checkout.
  - `update_booking_payment_method` exige la versión del mandato aceptado y la audita (evidencia ante contracargos, spec 0021).
  - La tarjeta reemplazada se desvincula solo si la nueva sigue vigente. Una tarjeta nueva nuestra que las reglas rechazan también se desvincula; una ajena o en uso nunca.
- **Página de 3DS** (`/booking/[token]/authenticate`):
  - Librería `js.onvopay.com` cargada desde el bundle, con `handleNextAction` y fallos reportados a Sentry.
  - Solo con el cobro esperando autenticación, y tras un GET que confirme `requires_action`. Nunca entrega el intent fuera de su estado.
  - `connect-src` suma `https://js.onvopay.com`.
- **Reglas de acceso compartidas** (`deferred-booking-rules.ts`) entre la página de la reserva, que muestra los enlaces, y las páginas de tarjeta y 3DS.
- **Estados de intent normalizados** en `lib/payments/types.ts` (`PaymentIntentStatus`).
- **Panel:** tarjeta e intentos de cobro en el detalle, y estado de pago priorizando el pago vigente. `BookingDetailActions` y `admin-today.ts` se separan por tamaño.
- **Revisión** de payment-flow-auditor y code-reviewer, sin caminos de doble cobro. Arreglos:
  - un liquidado sin monto ya no marca `payment_mismatch`;
  - `already_processed` solo se informa como confirmada si la reserva lo está;
  - rowcount 0 alerta;
  - mandato en el cambio de tarjeta;
  - race del detach;
  - una sola regla de acceso;
  - constantes, y `CardUpdateError` fuera de un módulo `server-only` que importaba el formulario.
- **Tests:**
  - integración del cobro manual: primer cobro, rechazo, 3DS, timeout, reintentos, intent cerrado, concurrencia con dos staff, respuestas incompletas, escrituras sin efecto y alertas;
  - integración del cambio de tarjeta: rechazos, límite, en vuelo, mandato, detach;
  - integración del acceso a las páginas y de los enlaces de la vista;
  - unitario del mapeo de outcomes.

**Por qué / decisiones**:

- El intent nuevo no se crea dentro de la hora posterior al último intento: la regla es de SQL, pero así un click repetido no crea y cancela intents en OnvoPay.
- El mandato del cambio de tarjeta reusa la versión del aviso de privacidad (`PRIVACY_NOTICE_VERSION`), la misma que estampa el checkout.
- La página de 3DS ofrece el desafío aunque el GET falle: bloquearla ante un error transitorio de OnvoPay perdería la venta, y el intent igual no se entrega fuera de su estado.
- Sin test unitario de `next-action.ts`: el repo no tiene `jsdom` y no se suma una dependencia para esto. Lo cubre la prueba manual de 3DS en sandbox con la CSP en modo enforce que el spec exige en el PR.

**Pendiente**:

- Prueba manual en sandbox, antes del merge: flujo completo, rechazo con `4000000000000002` y 3DS con `4000000000003220` con la CSP en modo enforce.
- PR a `dev` (lo mergea el usuario).
- Confirmar con el usuario la política de aviso desde el cuarto rechazo.
- Deudas señaladas por la auditoría, para antes de abrir el flag: tope de tokenizaciones por customer (consultar a OnvoPay), código de rechazo real en `charge_last_error`, validar al boot que las llaves sean del mismo modo, y la costura de PayPal (vault de tarjeta y mapeo de estados dentro del adapter).

**Notas para retomar**:

- `lib/booking/sentry-alert.ts` es la función común de alertas del checkout, el cambio de tarjeta y el cobro manual (solo ids).
- `manual-charge-edge-cases.test.ts` sincroniza la creación de los dos intents con una barrera, para que la concurrencia sea determinista.

## 2026-09-16 11:40 — Workstream B, unidades 3a y 4: checkout diferido, cancelación sin cobro y emails del ciclo de cobro

**Hecho**:

- Adapter de OnvoPay partido por recurso (`web/lib/payments/adapters/onvopay/`): métodos nuevos `getPaymentIntent`, `confirmWithPaymentMethod` (un 400 se resuelve con GET), `createCustomer`, `getPaymentMethod` (respuesta validada con Zod), `detachPaymentMethod` y `deleteCustomer`. Ids escapados en la ruta y errores sin el cuerpo de la respuesta.
- Tokenización desde el navegador dentro del adapter, con la costura `lib/payments/card-vault.ts` para los componentes. Timeout, y distinción entre tarjeta rechazada y proveedor no disponible.
- Checkout diferido en dos pasos detrás de `DEFERRED_CHARGE_ENABLED`:
  - paso 1: hold y customer guardado en el hold;
  - paso 2: payload validado entero con Zod, sesión y hold verificados antes de llamar a OnvoPay, tarjeta leída por GET (mismo customer, mismo id, no `detached`), monto recalculado y comparado con el del mandato (`amount-changed`), y reintento idempotente que devuelve la misma reserva.
- Con el flag encendido, el checkout con widget se rechaza.
- UI: formulario de tarjeta sin `name` ni `action`, mandato con el monto, botón para empezar de nuevo y datos del paso 1 que sobreviven el reset del form de React 19. Página de éxito para `pending_minimum`.
- Cancelación de `pending_minimum` por turista y staff vía `cancel_unpaid_booking`. El motivo sale del tipo de actor. Un cobro en vuelo devuelve `ChargeInFlight`, y la página de cancelación lo explica. Archivar un tour con reservas sin cobrar queda bloqueado.
- Alertas a Sentry, sin PII, cuando un customer de OnvoPay puede quedar huérfano y cuando llega una tarjeta de otro customer.
- Emails (unidad 4):
  - `booking_reserved`, aviso de tarjeta rechazada (una plantilla para `_1`, `_2` y `_3`, con enlace a `/booking/[token]/card`) y `charge_requires_action` (enlace a `/booking/[token]/authenticate`).
  - Cada aviso sale solo en su estado, y el token de su enlace vence con su plazo.
  - `cancellation_confirmation` dice que no hubo cobro cuando la reserva diferida nunca se cobró.
- Despacho explícito por kind en `send-notifications` (`notifications/dispatch.ts`): ningún kind cae en la plantilla de reserva confirmada. `departure_cancelled_minimum` (C) se pospone una hora con alerta en vez de cancelarse.
- Revisión de la 3a por payment-flow-auditor y code-reviewer (sin críticos): los arreglos de arriba salen de ahí.
- Tests nuevos:
  - integración de las actions del checkout (validación, sesión, tarjeta, monto, idempotencia, flag), de la cancelación por token y por staff, del archivado y de los emails con Mailpit;
  - unitarios del adapter y la tokenización con fetch simulado, de las plantillas, del despacho y del kind pospuesto.
- Suites verificadas: web unit 286/286, web integración 387/387, worker unit 198/198. Worker integración: 53/53 en la última corrida completa, más la suite nueva de emails (6/6) corrida junto con la existente (3/3). `tsc` limpio y eslint sin errores en web y worker.

**Por qué / decisiones**:

- La ruta de actualización de tarjeta es `/booking/[token]/card`: el spec no la nombra y los segmentos de URL van en inglés. Las páginas `card` y `authenticate` llegan con la unidad 3b, en el mismo PR y con el flag apagado.
- Monto del mandato: el cliente reenvía el monto que mostró y el servidor rechaza si el recalculado difiere, en lugar de guardar el monto del paso 1 en el hold (sin cambio de esquema). Nombre y email del paso 2 pueden diferir de los del customer creado en el paso 1; no afecta el dinero.
- Un kind sin plantilla se pospone y no se cancela: si el worker queda detrás de la DB, cancelarlo perdería el email.
- `payment_mismatch` no libera el customer (sin cambios respecto de la entrada anterior).

**Pendiente**:

- Unidad 3b: página de actualización de tarjeta, página de 3DS y cobro manual del panel con "Volver a cobrar".
- Corrida completa de la integración del worker con la suite nueva, revisión final del PR y PR a `dev`.
- Confirmar con el usuario la política de aviso desde el cuarto fallo.
- Diferido para después (señalado por la auditoría): tope de velocidad de tokenizaciones por customer (consultar a OnvoPay), validar al boot que las llaves pública y secreta sean del mismo modo, y costura de PayPal para crear el "vault" de tarjeta (hoy `createCustomer`).

**Notas para retomar**:

- `lib/booking/checkout-action.test.ts` mockea `deferred-flag`: ese flag lee la env tipada al importarse.
- Las suites web del checkout diferido mockean `@/lib/env` con un Proxy para encender el flag y apagar el rate limit.
- El reembolso del 100% en una cancelación iniciada por el operador (§5.8) es de `cancel_departure` (workstream C); la cancelación individual de una confirmada desde el panel sigue con `computeRefund`.

## 2026-09-15 23:40 — Workstream B: arreglos de la segunda revisión de las unidades 1 y 2

**Hecho**:

- Segunda revisión (payment-flow-auditor y code-reviewer). Sin hallazgos críticos; un alto, varios medios y cuatro bloqueantes de tipos y tests. Arreglos:
  - `database.ts`: `update_booking_payment_method` no tenía `p_customer_external_id` ni todos sus outcomes (bloqueante: `tsc` no lo veía por el objeto en variable).
  - Rotación de lotes (`charges/batch-rotation.ts`) en las tres consultas de `watch-charges`, en el barrido y en la limpieza de customers: 50 filas que solo esperan (3DS con plazo de semanas, processing, holds todavía no limpiables) ya no traban al resto.
  - `watch-charges` hace GET antes de cancelar una `pending_minimum` que conserva un intent: liquidado se asienta, en processing espera, confirmable se cancela también en OnvoPay. Sin llave, esas reservas esperan.
  - Un 404 del GET es `not_found`: se trata como intent cerrado y se alerta con nivel error, en lugar de lanzar en cada ciclo para siempre.
  - `decideInFlight`: vencido un plazo, cancelar tiene precedencia sobre registrar un rechazo o un 3DS (no se encola un aviso sobre una reserva que se cancela igual). Cambió dos tests unitarios existentes, que quedaron obsoletos por esta decisión.
  - SQL (…044): `charge_booking_start` devuelve `retry_too_soon` dentro de la hora siguiente al último intento; `update_booking_payment_method` devuelve `update_limit_reached` tras 5 cambios de tarjeta; `record_intent_closed` y `record_customer_cleaned` reemplazan los UPDATE directos del barrido y la limpieza, con lock y auditoría; índice único `tour_holds_one_per_customer`; los caminos de mismatch cancelan los avisos de cobro; acción de auditoría propia `booking.late_payment_refund_blocked`; el guard de monto de una diferida solo mira la fila `pending` del intent.
  - Jobs con pasos aislados; el cancel fallido de un intent alerta; el conteo de fuera de ventana solo cuenta reservas canceladas; switches exhaustivos; un solo espejo de `ConfirmOutcome` y una sola función de alerta en el worker; constantes de estado en `charges/statuses.ts`.
  - Plata que requiere reembolso manual (`duplicate_payment`, `late_payment_refund_blocked`) alerta con nivel error y fingerprints en kebab-case en el webhook, el reconciliador y los jobs. El webhook mapea outcome → alerta en `lib/payments/webhook-outcome-alert.ts` y alerta un outcome desconocido.
- Tests nuevos: bordes exactos de las decisiones, rotación, cliente HTTP de OnvoPay del worker, alertas por outcome (settle, reconciliador, webhook); integración de los jobs con fallo y reintento, 404, mismatch, GET sin monto, processing estancado, estado inesperado, plazos vencidos con cobro en vuelo, cancel fallido, reservas con intent retenido, ciclo sin llave, idempotencia del barrido y carrera con el webhook, reintento de detach y alerta de ventana; en web, suite `deferred-booking-safeguards` y borde de 24 h del recordatorio. Orden de tests señalado por la revisión (filas explícitas, asserts de largo antes de desestructurar).
- Suites verificadas: web unit 254/254, web integración 362/362, worker unit 174/174, worker integración 53/53; `tsc` limpio en web y worker; eslint sin errores.

**Por qué / decisiones**:

- La hora mínima entre intentos vive en SQL y vale también para el cobro manual del panel: "Volver a cobrar" dentro de esa hora recibirá `retry_too_soon`. Protege la reputación de la tarjeta ante las marcas y sostiene el gate por intent. El spec solo fijaba el tope horario para el cambio de tarjeta.
- El tope de 5 cambios de tarjeta se cuenta en `audit_logs`, que es append-only: no hace falta una columna nueva ni se puede reiniciar. Número elegido por nosotros; el spec no fija uno.
- Un 404 se trata como cerrado porque un intent que no existe para la llave no puede cobrar en esta cuenta; la alerta cubre el caso de llave o entorno cruzados.
- `payment_mismatch` sigue sin liberar el customer: queda en revisión manual y la resolución puede necesitar la tarjeta.
- La rotación guarda el offset en memoria: un reinicio vuelve al principio, que es seguro.

**Pendiente**:

- Commit de las unidades 1 y 2 con estos arreglos.
- Unidad 3a (escrita, sin commitear): adapter de OnvoPay partido en carpeta con los métodos nuevos, checkout diferido en dos pasos, flag `DEFERRED_CHARGE_ENABLED`, página de éxito y cancelación de `pending_minimum` (turista y panel), bloqueo de archivado. Faltan sus tests de integración (actions con el proveedor simulado y cancelación).
- Unidad 3b: actualización de tarjeta, página de 3DS y cobro manual del panel.
- Unidad 4: emails de los kinds nuevos y dispatch explícito en `send-notifications`. Tiene que entrar en el mismo PR que la 3: hoy un kind nuevo cae en la plantilla de reserva y se cancela si la reserva no está `confirmed`.
- Confirmar con el usuario la política de aviso desde el cuarto fallo.

**Notas para retomar**:

- Los mocks de OnvoPay, Sentry y env de las suites del worker viven en `worker/tests/integration/charge-mocks.ts`; las fábricas de `vi.mock` lo importan y comparten el estado con el test.
- El fixture `startCharge` (web y worker) simula que pasó la hora entre intentos; los tests de esa separación llaman `charge_booking_start` directo.
- La nota de la entrada anterior sobre starvation en la limpieza de customers quedó resuelta con la rotación.

## 2026-09-15 19:30 — Workstream B, unidad 2: jobs del worker, y arreglos de la revisión de la unidad 1

**Hecho**:

- Revisión de la migración 044 por db-schema-guardian y payment-flow-auditor (dos hallazgos altos y dos bloqueantes, ninguno alcanzable todavía porque nada llama a estas funciones). Arreglos, con la migración reescrita antes de commitear:
  - `charge_attempt_failed` y `charge_requires_action` reciben el intent y solo actúan si su fila sigue `pending`: una respuesta vieja de un intento anterior ya no puede cerrar en falso el intento actual (camino a un doble cobro).
  - `confirm_booking` detecta un segundo intent cobrado sobre una reserva resuelta (`duplicate_payment`), no reporta un refund que no se encoló (`late_payment_refund_blocked`), y una diferida solo confirma contra la fila `pending` de su intent.
  - `charge_booking_start` exige la tarjeta vigente (`payment_method_changed`) y una salida futura no cancelada (`departure_unavailable`).
  - `create_deferred_booking` bloquea la salida y rechaza una cancelada mientras el turista tokenizaba (`INSTANCE_UNAVAILABLE`).
  - Nueva `close_pending_payment` para liberar la fila `pending` de una `pending_minimum` cuyo intent se cerró fuera de un cobro en vuelo.
  - Cancelar o confirmar cancela los avisos de cobro pendientes; plazo nulo, datos de tarjeta fuera de rango y motivos de cancelación desconocidos fallan explícitos; cierre manual solo tras 7 días; `retained_count` en la baja a pedido; tope de un intento por hora al cambiar la tarjeta; índice para `watch-charges`; comentarios críticos de …040 restaurados.
- Callers: el webhook y el reconciliador alertan los outcomes nuevos y ya no se tragan un outcome desconocido.
- Worker (`worker/src/charges/`): cliente de OnvoPay (GET y cancel de intents, métodos del customer, detach, borrado), decisiones puras de la tabla de §5.5, del barrido y de la limpieza de customers, y asentamiento de cobros liquidados con validación de monto.
- Jobs `watch-charges` (cada minuto: resuelve cobros en vuelo por GET, cancela plazos vencidos y la red terminal de `pending_minimum`) y `close-payment-intents` (cada 5 minutos: cierra intents de reservas canceladas, asienta cobros tardíos, alerta los que pasan 7 días y borra customers que ya nadie necesita), programados en `index.ts`.
- Tests: unitarios de las decisiones; integración de los dos jobs con OnvoPay simulado; y en web, casos para cada arreglo de la revisión.

**Por qué / decisiones**:

- Aviso desde el cuarto fallo: se reemplaza la fila `_3` ya procesada por una nueva, así cada rechazo se notifica (Q7) con un id nuevo como clave de idempotencia del proveedor de email, sin cambiar la unicidad `(booking_id, kind)`. Reemplaza la interpretación de la entrada anterior (un cuarto fallo sin aviso). **Pendiente de confirmar con el usuario.**
- `watch-charges` decide siempre por el GET del intent y nunca re-confirma ni crea intents: eso es de `charge-bookings` (C) y del cobro manual del panel.
- Los pasos solo-SQL de `watch-charges` (plazos vencidos y red terminal) corren aunque falte la llave de OnvoPay.
- Limpieza de customers: se borra en OnvoPay solo cuando ninguna reserva del hold puede volver a cobrarse (checkout abandonado, reserva cerrada sin intents abiertos, o confirmada con la salida ya empezada). `detach` explícito antes del DELETE, porque la documentación no dice que borrar el customer desvincule sus métodos.

**Pendiente**:

- Segunda revisión (payment-flow-auditor y code-reviewer) y commit de las unidades 1 y 2.
- Unidad 3: métodos nuevos del adapter de web, checkout con formulario propio, actualización de tarjeta, 3DS, cancelación del turista y cobro manual del panel.
- Unidad 4: emails de los kinds nuevos, dispatch explícito en `send-notifications`, bloqueo de archivado.

**Notas para retomar**:

- Quien llame a `charge_booking_start` debe cancelar el intent que haya creado ante cualquier outcome distinto de `started`.
- `flag_payment_mismatch` sobre una `pending_minimum` deja la fila `pending` con un intent potencialmente pagable, y el barrido solo mira reservas canceladas: resolver en la revisión manual del mismatch.
- La retención usa tres sentencias con snapshots distintos: si un intent se cierra entre ellas, la corrida del día falla por FK y se reintenta al siguiente (no borra de más).
- Starvation posible en la limpieza de customers si más de 50 holds `expired`/`released` quedan retenidos por intents abiertos (lote ordenado por fecha).

## 2026-09-15 17:00 — Workstream B, unidad 1: funciones SQL del cobro diferido y guardas

**Hecho**:

- Migración `20260915000044_deferred_charge_functions.sql`: `create_deferred_booking` (reserva `pending_minimum` y hold `paying` en una transacción, con customer, asientos, consentimiento y vencimiento de tarjeta validados bajo lock), `charge_booking_start`, `charge_attempt_failed`, `charge_requires_action`, `cancel_charge_in_flight`, `cancel_unpaid_booking`, `update_booking_payment_method` y `mark_payment_provider_closed`.
- `confirm_booking` con gate positivo de estado y outcome `confirmed_unclaimed`; `flag_payment_mismatch` acepta `pending_minimum`; `cancel_stale_pending_booking` no toca un cobro en vuelo; `anonymize_booking_pii_by_email` y `purge_unpaid_bookings` excluyen reservas vivas e intents potencialmente abiertos (helper `booking_retention_locked`).
- Callers: el webhook y el reconciliador alertan `confirmed_unclaimed`; el reconciliador ya no trae reservas con `charge_started_at`. `AuditAction` nuevos, `ConfirmBookingOutcome.ConfirmedUnclaimed` y tipos de las funciones en `database.ts`.
- Tres suites de integración (ciclo de vida, cancelaciones, guardas y retención) con fixtures compartidos; `cleanup.ts` ahora borra `tour_holds`.

**Por qué / decisiones**:

- Reintentos: los fallos 1, 2 y 3 agendan 1 h, 6 h y 24 h y emiten `_1`, `_2` y `_3`. Un cuarto fallo no agenda ni avisa: la unidad `(booking_id, kind)` lo impide y el turista ya tiene el enlace válido hasta `recovery_deadline`. Interpretación de §5.7, que no fija qué pasa tras el tercer aviso.
- Retención: los pagos `pending` bloquean el borrado en cualquier flujo, como dice §6; los `failed` sin cierre solo en el flujo diferido (recomendación de db-schema-guardian en A).
- `confirm_booking` ya no encola un `reminder_24h` con la hora vencida (§8). También cambia el flujo con widget.
- `confirm_booking` usa CREATE OR REPLACE y no DROP + CREATE como decía §6: la firma y el tipo de retorno no cambian.
- El vencimiento de la tarjeta se valida también en SQL, además de en la app.
- Tres tests existentes quedaron obsoletos por el spec 0029 y se actualizaron citándolo: `notifications-enqueue` esperaba el recordatorio vencido (§8), y dos de `retention-anonymization` usaban como "abandonada" una `pending_payment` con pago `pending`, que ahora se conserva (§6). Los fixtures pasaron a `cancelled` con pago `failed`, que es como deja el reconciliador un checkout abandonado.
- **Corrección a la entrada anterior:** dije que auditar el cambio de la ventana requería ampliar los CHECK de `audit_logs`. Es falso: `action` y `entity_type` son texto libre, sin CHECK. La sugerencia sigue sin aplicar, pero no por esa razón.

**Pendiente**:

- Revisión de db-schema-guardian y payment-flow-auditor sobre la migración 044, y commit de la unidad.
- Unidad 2: métodos nuevos del adapter de OnvoPay y jobs `watch-charges` y `close-payment-intents`.
- Unidad 3: checkout con formulario propio, actualización de tarjeta, 3DS, cancelación del turista y cobro manual del panel.
- Unidad 4: emails y dispatch explícito de kinds en el worker de notificaciones; bloqueo de archivado.

**Notas para retomar**:

- `cancel_charge_in_flight` y `cancel_unpaid_booking` encolan `cancellation_confirmation`; su plantilla tiene que decir que no hubo cobro cuando la reserva es diferida.
- `charge_requires_action` no reenvía el enlace en un segundo 3DS de la misma reserva (misma unicidad); la página de la reserva tiene que ofrecerlo.

## 2026-09-15 15:20 — Workstream A: esquema, configuración y toggle del mínimo

**Hecho**:

- Migración `20260913000043_minimum_participants_deferred_charge.sql`, solo esquema: columnas del cobro diferido en `bookings`, `payments` y `tour_holds`; estado `pending_minimum`; seis kinds de notificación nuevos; resolución del mínimo por salida en `tour_instances`; tabla de fila única `business_settings` con RLS (lectura admin/staff, escritura admin con `updated_by = auth.uid()`) y grants por columna; allowlist de la red de grants actualizada. Ninguna función escribe estos datos todavía.
- Toggle "Cancelar automáticamente, sin avisar al staff" en el formulario de tours, en su propio componente (`TourMinimumPolicyField`), y página admin `/dashboard/settings` para la ventana de decisión, con entrada en la navegación.
- `BookingStatus.PendingMinimum`, `MinimumResolution`, los `NotificationKind` nuevos, la copia local del worker y `web/types/database.ts` editado a mano. i18n ES/EN, incluidas las etiquetas `notif-*` de los kinds nuevos que usa el detalle de reserva.
- Tests: unitarios del schema de configuración y del parseo del toggle; integración del esquema, de `business_settings` (RLS y grants), de la action de configuración y de las actions de tours con el toggle.
- Verificado a mano con Playwright: guardar la ventana como admin (autor registrado), página en EN, redirección y navegación sin "Configuración" para staff, toggle persistido y conservado tras un error de validación.

**Por qué / decisiones**:

- Desvíos de §6 sugeridos por db-schema-guardian y aceptados, todos sin choque con B ni C:
  - el trigger de inmutabilidad cubre monto **y moneda**, que juntos forman el mandato;
  - `payments_failed_unclosed_idx` va sobre `failed_at` y exige `failed_at IS NOT NULL`: las filas `failed` del flujo vigente no tienen `failed_at` y no deben acumularse en el barrido;
  - el índice de reintentos filtra `pending_minimum` y el de salidas sin resolver excluye las canceladas;
  - CHECK de coherencia en `tour_instances`: disparo si y solo si la resolución es `reached` o `staff_confirmed`; snapshot obligatorio al disparar (con `IS NOT NULL` explícito, porque un CHECK que evalúa a NULL se acepta; lo detectó un test); actor solo en decisiones del staff;
  - `pending_minimum` exige también `customer_external_id`; rangos para `card_exp_month`, `card_exp_year` y `charge_attempts`;
  - índices únicos con nombre descriptivo (`bookings_one_live_per_payment_method`, `payments_one_pending_per_booking`) y grant explícito a `service_role` en `business_settings`.
- El checkbox usa `defaultChecked` y no `checked`: React 19 hace `form.reset()` tras la action y eso desmarcaba en el DOM el checkbox controlado. Lo encontró la prueba manual (el admin perdía su elección tras un error de validación) y el arreglo quedó verificado en el navegador.
- Los tests cierran sesión con `signOut({ scope: 'local' })`: el `signOut()` por defecto es global y cerraba la sesión del navegador de quien corre la suite con el usuario del seed.
- No se audita en `audit_logs` el cambio de la ventana: requiere ampliar los CHECK de `audit_logs` y el spec no lo pide. Queda como sugerencia.
- El bloqueo de archivado con `pending_minimum` y el dispatch de kinds sin plantilla se dejan para B, donde el spec los ubica y donde nacen los writers.

**Pendiente**:

- PR del workstream A a `dev`.
- Workstream B (ver notas).

**Notas para retomar** (requisitos para B):

- Retención: la exclusión de pagos `failed` con `provider_closed_at IS NULL` debe acotarse a `payment_method_id IS NOT NULL`; si no, la purga de 90 días deja de borrar los checkouts abandonados del flujo vigente.
- Worker de notificaciones: `worker/src/jobs/send-notifications.ts` manda cualquier kind sin rama propia al camino de reserva. Con la reserva sin confirmar, la notificación queda cancelada para siempre (unicidad `booking_id, kind`); con la reserva confirmada, sale la plantilla del recordatorio 24h. Antes de encolar los kinds nuevos: lista explícita o `assertNever`, y los desconocidos quedan en `pending`.
- `confirm_booking` (`…040:182`) asume que tras sus filtros el estado es `pending_payment`: con `pending_minimum` confirmaría sin cobro. En el DROP + CREATE de B, reemplazar por un chequeo positivo.
- Gate por `charge_started_at` en `cancel_stale_pending_booking` y en el reconciliador (§5.4).
- No contemplan `pending_minimum`: archivado (`web/lib/tours/archive-action.ts:72`), cancelación del turista y del panel, y la página de éxito del checkout.
- `payments_one_pending_per_booking` es un índice parcial: como árbitro de `ON CONFLICT` exige `ON CONFLICT (booking_id) WHERE status = 'pending'`. Preferir la guarda bajo `FOR UPDATE` de §6.
- Después de B, la migración …043 no tiene rollback seguro (ver su header).
- Si el cobro diferido se extiende a otra pasarela: agregar `payment_method_provider` y llevarlo al índice único.
- `web/.next/types/validator.ts` (artefacto local ignorado) apunta a la ruta vieja `bookings/hoy` y rompe `tsc` local; con un build limpio no aparece.
