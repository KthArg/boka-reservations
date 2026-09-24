# 0032 — Reembolso sin la comisión de procesamiento en cancelaciones del cliente

- **Estado**: approved
- **Autor**: Kenneth (con Claude Code)
- **Creado**: 2026-09-21
- **Última actualización**: 2026-09-22
- **Rama**: feat/0032-reembolso-sin-comision
- **PR**: (sin asignar)

## 1. Contexto y motivación

Cuando un turista cancela una reserva ya cobrada con al menos 24 horas de antelación, hoy se le devuelve el 100 % de lo que pagó (decisión del 2026-05-19 en `.claude/memory/decisions.md`, spec 0011, `computeRefund` en `shared/constants/policies.ts`). OnvoPay, la pasarela de pagos, cobra al comercio una comisión por cada cobro con tarjeta. Su página de precios (`https://onvopay.com/pricing`, consultada el 2026-09-21) dice **3,9 % + US$0,35** por transacción exitosa, pero el soporte aclaró el 2026-09-23 que la tarifa real de la cuenta del cliente son varios componentes más una retención de IVA del 0,777 % sobre la comisión: las constantes se ajustan con la tabla de la cuenta antes de activar (§13). La decisión de 2026-05-19 registraba "3,5 % + IVA", y `docs/onvopay-consulta-reembolsos.md` "~3,9 % + US$0,25"; la cifra vigente es la de la página de precios y se confirma contra un estado de cuenta antes de activar (§13).

**Confirmado el 2026-09-23** por el soporte de OnvoPay: la comisión no vuelve al comercio al reembolsar, ni en un reembolso total ni en uno parcial, y no existe un cargo aparte por reembolsar. Queda registrado en `docs/onvopay-consulta-reembolsos.md`.

Bajo ese supuesto, cada cancelación voluntaria le cuesta al operador la comisión de un cobro del que no obtuvo nada: en un tour de US$60, US$2,69. El cliente decidió el 2026-09-21 que, cuando el turista cancela por decisión propia, se le devuelva lo pagado **menos la comisión de procesamiento**. Si el operador tuviera que absorberla, preferiría no ofrecer reembolso. El código ya anticipaba esta opción (el `TODO(política-cliente)` de `computeRefund`).

El descuento aplica solo cuando cancelar es decisión del turista. Si la causa es del operador o del sistema (el operador cancela, sobreventa, pago tardío sobre una reserva ya cancelada), el turista recibe el 100 %.

El cambio afecta al turista (recibe menos), al staff (elige el motivo al cancelar desde el panel) y a los textos legales (los términos y el checkout deben decirlo antes de la compra).

Depende del spec 0031, que agrega `bookings.terms_version` y el estampado de la versión de términos aceptada. **0031 debe estar mergeado antes de empezar la implementación de este spec.**

## 2. Objetivos

- Descontar la comisión de procesamiento del reembolso cuando el turista cancela una reserva cobrada por decisión propia.
- Mantener el reembolso total cuando la cancelación es por decisión del operador o la produce el sistema.
- Informar la regla antes de pagar y mostrar, antes y después de cancelar, cuánto se reembolsa y cuánto se descuenta.
- Aplicar la regla solo a reservas cuyo cliente aceptó términos que la incluyen.

## 3. Fuera de alcance

- No se cambia la ventana de 24 horas: con menos de 24 horas de antelación, una cancelación del cliente sigue sin reembolso.
- No se cambia la cancelación de reservas aún no cobradas del flujo diferido (spec 0029): siguen sin costo y sin motivo.
- No se cambian los reembolsos automáticos del sistema (sobreventa y pago tardío en `confirm_booking_payment`): siguen siendo totales.
- No se agrega SINPE Móvil ni otro método de pago, y no se cobra recargo por pagar con tarjeta.
- No se leen las comisiones reales de OnvoPay: la API no las expone. Se revisó `https://docs.onvopay.com/openapi.yaml` el 2026-09-21 y solo aparecen comisiones de marketplace.
- No se cambia el `reason` que se envía a OnvoPay al crear el reembolso (hoy siempre el default `requested_by_customer`) ni la columna `refunds.reason`. El motivo queda en el audit log.
- No se redacta el texto de los términos: lo aportan el operador y su abogada. Este spec define qué debe decir y cómo se activa.
- No se borra la versión vieja de `cancel_booking`: queda para una migración de limpieza posterior (§11).
- Reportes: solo se corrige el bruto de `report_revenue` (§5.7); lo demás no cambia.
- El panel no muestra la comisión descontada: queda en `refunds.processing_fee_cents` y en el audit log de la cancelación.
- No se implementa la cancelación de una salida completa por el operador (`cancel_departure`, workstream C del spec 0029, todavía sin implementar). Cuando se implemente debe reembolsar el total con `processing_fee_cents = 0`; si reutiliza `cancel_booking`, con la firma de 6 parámetros y `operator_decision`.

## 4. Historias de usuario

> Como turista que va a reservar, quiero saber antes de pagar qué pasa si cancelo, para decidir con la información completa.

- [ ] Con la política activa, el checkout muestra junto a la casilla de términos (los montos con el formato del locale: "3,9%" y "USD 0,35" en ES, "3.9%" y "$0.35" en EN): "Si cancelás con 24 horas o más de antelación, te devolvemos lo pagado menos la comisión de procesamiento del pago (3,9 % + US$0,35). Con menos de 24 horas no hay reembolso."
- [ ] Con la política inactiva, ese texto no aparece.

> Como turista que decide cancelar con 24 horas o más de antelación, quiero ver cuánto me van a devolver, para saber que se descuenta la comisión.

- [ ] La página de cancelación muestra el monto a reembolsar y, aparte, la comisión descontada. Por ejemplo: "Te reembolsamos US$57,31. Se descuenta la comisión de procesamiento del pago: US$2,69".
- [ ] El monto se recalcula al confirmar. Si el estado de la reserva o el monto no coinciden con lo que mostró la página (por ejemplo, el cobro diferido se completó o se cruzó el borde de 24 h), no se cancela y la página pide recargar. Si coinciden, el resultado muestra el monto aplicado y, si lo hubo, el descuento.
- [ ] El email de confirmación de cancelación y el de reembolso acreditado indican el monto y la comisión descontada.
- [ ] Con menos de 24 horas, la página sigue indicando que no hay reembolso.

> Como staff que cancela una reserva cobrada desde el panel, quiero indicar si la cancelo a pedido del cliente o por decisión del operador, para que el reembolso sea el correcto.

- [ ] Al cancelar una reserva `confirmed`, el panel pide elegir "A pedido del cliente" o "Por decisión del operador", sin opción preseleccionada, y muestra el monto de cada una. Si al confirmar el monto de la opción elegida ya no es ese, no se cancela y el diálogo pide recargar.
- [ ] "A pedido del cliente" aplica la misma regla que la cancelación del turista.
- [ ] "Por decisión del operador" reembolsa el 100 % sin importar la antelación, con una restricción: si la salida ya empezó, solo un `admin` puede elegirla.
- [ ] El motivo y la comisión quedan en el audit log de la cancelación.
- [ ] Cancelar una reserva sin cobrar (`pending_minimum`) sigue sin pedir motivo.

> Como turista que reservó antes de este cambio, quiero que se respeten las condiciones que acepté.

- [ ] Una reserva con `terms_version` nulo, o anterior a la versión de corte, recibe el reembolso total al cancelar con 24 horas o más.

## 5. Diseño técnico

### 5.1 Configuración y cálculo de la comisión

En `shared/constants/policies.ts`:

- `PROCESSING_FEE_PERCENT_BPS = 390` (3,9 % en puntos básicos).
- `PROCESSING_FEE_FIXED_CENTS: Partial<Record<Currency, number>> = { USD: 35 }`. Representa el costo **total** que cobra OnvoPay por transacción, IVA incluido si lo hubiera (§13).
- `REFUND_FEE_FROM_TERMS_VERSION: string | null = null`. La primera versión de términos que contiene la cláusula. En `null`, la política está **inactiva**.

`computeProcessingFee(totalCents, currency)` usa solo aritmética entera:
`floor((totalCents × PROCESSING_FEE_PERCENT_BPS + 5000) / 10000) + PROCESSING_FEE_FIXED_CENTS[currency]`.
Si la moneda no tiene comisión fija configurada, lanza `ProcessingFeeNotConfiguredError`.

La comisión se calcula sobre `bookings.total_amount_cents`. Es igual al monto cobrado: el guard de `payment_mismatch` (specs 0014 y 0026) impide confirmar una reserva cuyo pago no coincide con el total.

### 5.2 Motivos de cancelación

Nueva constante en `shared/constants/cancellations.ts`:

```
export const CancellationReason = {
  CustomerRequest: 'customer_request',
  OperatorDecision: 'operator_decision',
} as const;
```

El valor `customer_request` coincide con el de `UnpaidCancelReason`; `operator_decision` es nuevo. El turista siempre cancela con `customer_request`.

### 5.3 `computeRefund`

Recibe `{ startsAt, totalAmountCents, currency, termsVersion, reason, now }` y devuelve `{ eligible, amountCents, feeCents }`:

| Caso                                                                                    | `amountCents`         | `feeCents`        |
| --------------------------------------------------------------------------------------- | --------------------- | ----------------- |
| `operator_decision`                                                                     | total                 | 0                 |
| `customer_request`, menos de 24 h                                                       | 0                     | 0                 |
| `customer_request`, ≥ 24 h, política inactiva o `termsVersion` nulo o anterior al corte | total                 | 0                 |
| `customer_request`, ≥ 24 h, `termsVersion` ≥ corte                                      | `max(0, total − fee)` | `min(fee, total)` |

`eligible` es `amountCents > 0`. La comisión solo se calcula en la última fila, así que una moneda sin comisión configurada solo falla en ese caso. Hoy es teórico: los dos checkouts cobran siempre en USD (`CHECKOUT_CURRENCY` en `create.ts`, `DEFERRED_CURRENCY` en `deferred-checkout.ts`).

La comparación de versiones es de strings (`termsVersion >= REFUND_FEE_FROM_TERMS_VERSION`). Funciona porque las versiones son fechas `YYYY-MM-DD`, sin sufijos. Un test unitario valida el formato de `TERMS_VERSION` y del corte, y que, con el corte activo, `TERMS_VERSION >= REFUND_FEE_FROM_TERMS_VERSION` (si no, ninguna reserva nueva alcanzaría la política).

### 5.4 Flujos

- **`getBookingView`** (`web/lib/booking/cancel.ts`): `VIEW_SELECT` agrega `terms_version`. `toView` la usan la vista de la reserva, la página de cancelación y `cancelBooking`, para cualquier estado: calcula el reembolso con `customer_request` **solo si la reserva está `confirmed`**; en otro estado usa `{ eligible: false, amountCents: 0, feeCents: 0 }`. Si `computeRefund` lanza, `toView` lo atrapa, reporta a Sentry y usa ese mismo valor sin reembolso, para no tirar la página.
- **`cancelUnpaidBooking`** (`cancel-unpaid.ts`): su resultado sin reembolso (`NO_CHARGE_REFUND`) agrega `feeCents: 0`.
- **`cancelByToken(token, expected)`**: pasa `customer_request` y lo que mostró la página (`expected = { status, refundAmountCents }`), validado con Zod.
- **`cancelByStaff(bookingId, reason?, expectedRefundCents?)`**: valida con Zod el motivo y el monto que mostró el diálogo para ese motivo, y pasa a `cancelBooking` si el usuario es admin (`user.userRole === UserRole.Admin`).
- **Lo que vio quien cancela** (`expected`): si el estado de la reserva o el monto recalculado no coinciden, `cancelBooking` responde `CancellationError.StateChanged` (nuevo) sin cancelar. Evita cancelar un cobro que la pantalla mostraba como "sin cobrar", o un reembolso distinto del mostrado.
- **`cancelBooking`**: si la reserva está `pending_minimum` o `pending_payment`, sigue el camino de hoy (`cancelUnpaidBooking`) e ignora el motivo. Si está `confirmed`:
  1. Sin motivo válido, rechaza con `CancellationError.ReasonRequired` (nuevo).
  2. Con `operator_decision`, si `starts_at <= now` y el rol no es `admin`, rechaza con `CancellationError.OperatorRefundAdminOnly` (nuevo).
  3. Calcula con `computeRefund`. Si lanza, devuelve `WriteFailed` y reporta a Sentry.
  4. Si hay `expected` y el monto no coincide, `StateChanged`.
  5. Llama a la nueva `cancel_booking` con `p_reason` y `p_fee_cents`. Si devuelve `'already_cancelled'` (`CancelBookingOutcome`), responde `NotCancellable` sin monto.
- **`BookingDetailActions`**: calcula dos vistas previas, una por motivo y por separado (si falla la del cliente, la del operador sigue disponible). `AdminBookingDetail` ya trae `currency` y pasa a traer `terms_version`. La página del detalle resuelve una vez si el usuario es admin y lo pasa hacia abajo. `CancelBookingButton` deja el `window.confirm` y pasa a un diálogo con las dos opciones, sus montos y el botón de confirmar deshabilitado hasta elegir. Si la salida ya empezó y el usuario no es admin, "Por decisión del operador" aparece deshabilitada con la leyenda "Solo un admin puede reembolsar el total de una salida que ya empezó". Si el cálculo de la vista previa lanza, se reporta a Sentry y el diálogo muestra el error genérico.
- **`CancelConfirm`**: el mensaje posterior a cancelar muestra la comisión descontada, si la hubo.
- **Checkout**: con `REFUND_FEE_FROM_TERMS_VERSION` distinto de `null`, `ConsentField` muestra un `<p>` debajo de la casilla `CheckoutLegalField.Terms`, fuera de su `<label>` y enlazado con `aria-describedby`. No es una tercera casilla. Usa la clave nueva `checkout.refund-fee-notice` con placeholders `{percent}` y `{fixed}`, formateados por locale desde `PROCESSING_FEE_PERCENT_BPS` y `PROCESSING_FEE_FIXED_CENTS` ("3,9 %" en ES, "3.9%" en EN). Como `ConsentField` está en `CheckoutDetailsFields`, el aviso sale en los dos checkouts.

### 5.5 `cancel_booking` nueva

Se crea una sobrecarga nueva sin borrar la vigente (`cancel_booking(uuid, text, integer, uuid)` de la migración 042):

```
cancel_booking(
  p_booking_id uuid,
  p_actor_type text,
  p_refund_amount_cents integer,
  p_reason text,
  p_fee_cents integer,
  p_actor_id uuid DEFAULT NULL
) RETURNS text
```

- Mismo encabezado que la de la 042: `SECURITY DEFINER`, `SET search_path = ''` y guard `is_public_request()` (`FORBIDDEN_PUBLIC_ROLE`).
- Valida `p_reason IN ('customer_request','operator_decision')` (si no, `RAISE EXCEPTION 'INVALID_REASON'`), `p_fee_cents >= 0` (si no, `'INVALID_FEE'`) y que `operator_decision` venga con `p_fee_cents = 0` (si no, `'INVALID_FEE'`).
- Con la reserva cargada y confirmada: `operator_decision` exige `p_refund_amount_cents = total`, y siempre `p_refund_amount_cents + p_fee_cents <= total` (si no, `'INVALID_REFUND_AMOUNT'`). Así el reembolso total del operador queda garantizado en la base.
- Si el tope por lo cobrado (`LEAST` de la 042) recorta el monto, la comisión guardada se recorta también, para que reembolso + comisión nunca superen lo cobrado.
- Tiene el mismo cuerpo que la de la 042, más:
  - `reason` y `fee_cents` en el `metadata` del audit `booking.cancelled`, y `fee_cents` en el de `refund.requested`;
  - `processing_fee_cents = p_fee_cents` en la fila de `refunds` que encola.
- Devuelve `'cancelled'`, o `'already_cancelled'` si la reserva ya no estaba `confirmed` (hoy hace `RETURN` sin avisar). `cancelBooking` traduce `'already_cancelled'` a `CancellationError.NotCancellable`, así el segundo de dos cancelaciones concurrentes no ve un monto que no se aplicó.
- Permisos: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` y `GRANT EXECUTE ... TO service_role` explícitos sobre la firma nueva (patrón de 0031 §6.4 y de la migración 039). Crear una función le da `EXECUTE` a `PUBLIC` por defecto; sin el `REVOKE`, `anon` podría reembolsar montos arbitrarios, lo que cerró el spec 0018.

PostgREST distingue las dos sobrecargas por los nombres de los parámetros: una llamada con `p_reason` y `p_fee_cents` solo coincide con la nueva, con o sin `p_actor_id`, y una sin ellos solo con la vieja. La migración es compatible hacia atrás (el código viejo sigue funcionando con ella aplicada), pero **no** hacia adelante: el código nuevo necesita la firma nueva y la columna nueva. Por eso la 046 va **antes** del código (§11).

### 5.6 Worker

- `loadLatestRefund` lee también `processing_fee_cents` y lo devuelve como `feeCents`.
- `prepareCancellationEmail` y `prepareRefundEmail` (`prepare-cancellation.ts`) pasan `feeCents` a sus plantillas. `prepareOverbookedEmail` también usa `loadLatestRefund` y no cambia.
- `cancellation-confirmation` (solo cuando `hasRefund`) y `refund-confirmation` agregan, si `feeCents > 0`, la línea de la comisión descontada en ES y EN.
- El worker no calcula nada y no importa `@shared`: todo sale de la base.

### 5.7 Reportes: el bruto de `report_revenue`

`settle_refund` pasa el pago a `refunded` al acreditar el reembolso, aunque sea parcial, y `report_revenue` calculaba el bruto solo con pagos `succeeded`. Cada reembolso acreditado se restaba dos veces: con uno total, el neto de esa reserva daba −total en vez de 0. Con los parciales de este spec, el error crecía. La 046 reemplaza `report_revenue` con el mismo cuerpo, salvo que el bruto cuenta `status IN ('succeeded', 'refunded')`. Era un bug previo, detectado por la auditoría de pagos de este spec.

## 6. Modelo de datos

- **Tabla**: `refunds`. **Acción**: alter.
  - `processing_fee_cents integer NOT NULL DEFAULT 0 CHECK (processing_fee_cents >= 0)`. El default cubre las filas existentes y los reembolsos del sistema, que no descuentan comisión.
- **Función**: `public.cancel_booking`, sobrecarga nueva de seis parámetros (§5.5). La de cuatro parámetros no se toca.
- **Función**: `public.report_revenue`, `CREATE OR REPLACE` con el bruto corregido (§5.7). Conserva sus permisos.
- **Constraint**: `refunds_processing_fee_cents_check` (con nombre, para poder revertirla).
- **Migración**: `supabase/migrations/20260922000046_refund_processing_fee.sql`. Va después de la 045 del spec 0031.
- **Tipos**: actualizar a mano `web/types/database.ts` (el archivo se mantiene a mano; no se regenera).

## 7. Estados y transiciones

Sin cambios a las máquinas de estado. Una cancelación con reembolso parcial sigue el camino de hoy: la reserva pasa de `confirmed` a `cancelled`, y el reembolso de `pending` a `processing` y a `succeeded` o `failed`.

## 8. Casos borde y errores

- **Reserva anterior a 0031 o política inactiva**: reembolso total.
- **Staff sin motivo**: el botón queda deshabilitado; si la server action llega sin motivo para una reserva `confirmed`, `ReasonRequired`.
- **Reserva cuya salida ya empezó o pasó**: una reserva sigue `confirmed` después del tour, incluso con check-in. Con `customer_request` no hay reembolso (menos de 24 h). Con `operator_decision`, solo un `admin` puede reembolsar el 100 %, y queda auditado.
- **Cruce del borde de 24 h o cambio del flag entre ver la página y confirmar**: el monto se recalcula al confirmar y el resultado muestra el aplicado.
- **Dos cancelaciones concurrentes**: la primera cancela; la segunda recibe `'already_cancelled'` y ve un error de "ya no se puede cancelar".
- **Comisión mayor o igual al total**: solo pasa con un total de US$0,36 o menos, que ningún tour tiene. `computeRefund` devuelve `amountCents = 0`, no se encola reembolso y la página y el email muestran el texto de "sin reembolso" de hoy. No se agrega un texto propio.
- **Moneda sin comisión configurada**: solo falla la cancelación del cliente con la política activa. La cancelación no se aplica, se reporta a Sentry y el turista ve el error genérico. No se reembolsa un monto mal calculado.
- **Reintento manual de un reembolso fallido**: reintenta la fila existente con su monto; no recalcula.
- **Checkout abierto antes del deploy que activa la política y enviado después**: la reserva queda con la versión nueva, que incluye la cláusula, aunque el turista vio el texto anterior. La ventana es de minutos (el hold dura 15). Se acepta el riesgo; ver §13.

## 9. Impacto en otras áreas

- **Panel admin**: diálogo de cancelación con motivo (§5.4).
- **Emails**: `cancellation-confirmation` y `refund-confirmation`, en ES y EN.
- **i18n**: textos nuevos en `web/locales/es.json` y `en.json` (checkout, página de cancelación, `CancelConfirm`, diálogo del staff, errores `ReasonRequired` y `OperatorRefundAdminOnly`) y en las plantillas del worker.
- **Términos**: el operador agrega una cláusula como "Si cancelás con 24 horas o más de antelación, te devolvemos lo pagado menos la comisión de procesamiento del pago (3,9 % + US$0,35), que la pasarela no nos reintegra. Si cancelamos nosotros, te devolvemos el total."
- **Legal**: la abogada valida la cláusula y el aviso del checkout frente a la Ley 7472 antes de activar. Registrado en `docs/lanzamiento-checklist.md`.
- **Decisiones**: registrada en `.claude/memory/decisions.md` (2026-09-21), que reemplaza la política del 2026-05-19 y actualiza la tarifa de OnvoPay con su fuente y fecha.
- **Pagos**: el `amount` que se envía en `POST /v1/refunds` pasa a ser parcial en estos casos. `worker/src/refunds/onvopay.ts` ya lo envía. El OpenAPI (`PaymentIntent.amountReceived`) menciona reembolsos parciales; se prueba en sandbox (§10).
- **Reportes**: `report_revenue` corrige el bruto (§5.7); el neto de un período con reembolsos pasa a ser correcto.

## 10. Plan de tests

- **Unit (`web/lib/booking/refund-policy.test.ts`)**:
  - `computeProcessingFee`: 6000 → 269, 1000 → 74, 500 → 55 (caso de media).
  - Cada fila de la tabla de §5.3, el borde exacto de 24 h, `termsVersion` nulo, anterior, igual y posterior al corte, y política inactiva.
  - Moneda sin comisión: lanza solo en la rama que descuenta.
  - Formato `YYYY-MM-DD` de `TERMS_VERSION` y del corte, y `TERMS_VERSION >= corte` cuando el corte no es `null`.
  - Actualizar las aserciones existentes a `{ eligible, amountCents, feeCents }`.
- **Unit (plantillas del worker)**: con `feeCents > 0` aparece la línea; con 0 no.
- **Unit (`cancelBooking`)**: con el RPC mockeado devolviendo `'already_cancelled'`, responde `NotCancellable` sin monto; un error de `computeRefund` en `toView` no tira la vista.
- **Cómo se activa la política en los tests**: `computeRefund` recibe el corte como parámetro opcional (default `REFUND_FEE_FROM_TERMS_VERSION`), así los unit lo inyectan; los de integración con política activa hacen `vi.mock` de `@shared/constants/policies`. Los fixtures existentes estampan `p_terms_version: 'test-v1'`, que en comparación de strings es mayor que cualquier fecha: los fixtures nuevos usan versiones con fecha.
- **Integración (`cancel_booking`)**:
  - Cancelación del cliente con política activa: encola `total − comisión`, guarda `processing_fee_cents` y audita `reason` y `fee_cents`.
  - `operator_decision`: encola el total aun con menos de 24 h.
  - `p_reason` inválido, `p_fee_cents` negativo y `operator_decision` con comisión fallan.
  - Segunda cancelación devuelve `'already_cancelled'`.
- **Integración (permisos)**: `rpc-execute-grants.test.ts` indexa `STATE_MUTATING` por nombre de función y no admite dos `cancel_booking`: se agrega un `it` explícito para la firma de 6 parámetros (`p_reason: 'customer_request'`, `p_fee_cents: 0`) que verifica "permiso denegado" para `anon` y `authenticated`. Una llamada sin `p_reason` daría "función no encontrada" y el test pasaría sin probar nada. `secdef_functions_public_executable` y `audit_public_executable_functions` ya cubren la sobrecarga de forma genérica.
- **Integración (server actions)**: `cancelByStaff` sin motivo sobre `confirmed` → `ReasonRequired`; sin motivo sobre `pending_minimum` → cancela; `operator_decision` de un `staff` sobre una salida pasada → `OperatorRefundAdminOnly`.
- **Tests existentes a actualizar**: `cancellation.test.ts` (las llamadas a `cancelByStaff` sobre `confirmed` pasan el motivo, y las aserciones de `refund` incluyen `feeCents`), `refund-policy.test.ts` y `deferred-cancel-actions.test.ts` (`feeCents: 0` en el resultado sin cobro). `cierres-menores-0028.test.ts` y `late-payment-refund.test.ts` llaman a la firma de 4 parámetros, que sigue existiendo, y no cambian.
- **Manual**: con llaves de prueba, crear una reserva, cancelarla como turista y verificar en el dashboard de OnvoPay que el reembolso parcial tiene el monto esperado.

## 11. Plan de rollout

- **Feature flag**: `REFUND_FEE_FROM_TERMS_VERSION`, desplegado en `null`.
- **Orden de despliegue**: la 046 va **antes** del código de la web y del worker. Agrega una sobrecarga y una columna con default sin romper nada del código viejo, pero el código nuevo la necesita: al revés, fallan todas las cancelaciones de reservas confirmadas (`PGRST202`) y los emails de cancelación, reembolso y sobreventa (`loadLatestRefund` lee una columna que no existe) hasta aplicarla. Producción está en la 044: faltan la 045 (spec 0031) y la 046. El merge a `main` despliega la web en Vercel y el worker en Railway, así que el `db push` se hace antes de promover `dev → main`.
- **Activación**, cuando se cumplan las preguntas de §13:
  1. El operador publica los términos con la cláusula.
  2. En un solo deploy, se sube `TERMS_VERSION` a la fecha de esa versión y `REFUND_FEE_FROM_TERMS_VERSION` a la misma fecha.
- **Migración de datos**: no. Las reservas existentes conservan el reembolso total.
- **Comunicación**: avisar al operador que desde la activación los reembolsos por cancelación del cliente son parciales y que al cancelar desde el panel debe elegir el motivo.
- **Reversión**:
  - Volver el flag a `null` restaura el reembolso total para cancelaciones futuras.
  - Revertir el código no rompe nada: la función vieja sigue existiendo y la columna tiene default.
  - Los reembolsos parciales ya hechos no se completan solos; si hiciera falta, el staff los resuelve a mano en OnvoPay.
- **Limpieza**: una migración posterior borra `cancel_booking(uuid, text, integer, uuid)` (con la firma explícita: sin ella el DROP falla por ambigüedad) y mueve a la firma nueva los tests que todavía usan la vieja (`cierres-menores-0028.test.ts`, `late-payment-refund.test.ts`). Queda anotada en el checklist.
- **Dependencia**: el código lee `bookings.terms_version`, que agrega la 045 del spec 0031. Esta rama se mergea después de la del 0031, y en producción se aplican la 045 y la 046 antes de desplegar el código.

## 12. Métricas de éxito

- En las cancelaciones del cliente con la política activa, la comisión que OnvoPay cobró por esas transacciones coincide con `refunds.processing_fee_cents`, con una diferencia menor a US$0,01 por transacción.
- Cero reembolsos por encima de lo cobrado y cero reembolsos parciales con motivo `operator_decision`.

## 13. Preguntas abiertas

Ninguna bloquea la implementación. Todas bloquean la **activación** del flag.

- [x] **Respondida el 2026-09-23** (soporte de OnvoPay, registrada en `docs/onvopay-consulta-reembolsos.md`): la comisión **no** vuelve al comercio al reembolsar, ni total ni parcialmente, y **no** hay un cargo propio por reembolsar. El supuesto del spec queda confirmado.
- [ ] **Pregunta**: ¿Cuál es la tabla de comisiones y retenciones de tarjeta de la cuenta? El soporte aclaró el 2026-09-23 que la tarifa de la cuenta **no** es 3,9 % + US$0,35, sino varios componentes, más una **retención de IVA del 0,777 % sobre la comisión**. Con esos números se ajustan `PROCESSING_FEE_PERCENT_BPS` y `PROCESSING_FEE_FIXED_CENTS`, que hoy tienen la tarifa de lista. **Dueño**: Kenneth / operador. **Antes de**: activar la política.
- [ ] **Pregunta**: ¿La cláusula y el aviso del checkout cumplen la Ley 7472? ¿Alcanza con eso o hace falta el aviso también en la ficha del tour? **Dueño**: Dra. Xinia Guerrero. **Antes de**: 2026-09-30.

Anotado para decidir: hoy un staff puede cancelar "por decisión del operador" (reembolso total) dentro de las 24 h previas a la salida, donde a pedido del cliente no correspondería reembolso. Queda auditado con el motivo. La auditoría de pagos sugirió exigir admin también ahí; el usuario decidió restringirlo solo después del inicio de la salida.

Resueltas con el usuario el 2026-09-22: el aviso va en el checkout; "por decisión del operador" sobre una salida ya empezada es solo para admin; se descuenta el costo total de OnvoPay, IVA incluido si lo hay; se acepta el riesgo del checkout abierto durante el deploy de activación (§8). Tours en colones: no hay; los dos checkouts cobran en USD.
