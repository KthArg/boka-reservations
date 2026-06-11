# 0015 — Cálculo de precio autoritativo en el server (fix de manipulación de monto)

- **Estado**: approved
- **Autor**: Kenneth
- **Creado**: 2026-06-10
- **Última actualización**: 2026-06-10 (preguntas abiertas resueltas — aprobado)
- **Rama**: feat/0015-precio-autoritativo-checkout (cuando aplique)
- **PR**: # (cuando aplique)

> **Severidad: CRÍTICA (fraude de pago directo).** Este spec corrige el hallazgo
> **C-1** de la auditoría de seguridad del 2026-06-10. Es la única falla encontrada
> que rompe el modelo de seguridad por sí sola: permite a cualquiera reservar
> cualquier tour por el monto que elija (p. ej. 1 centavo). Debe resolverse **antes
> que cualquier otra cosa**, incluso antes del cutover a producción.

> **Nota sobre el nivel de detalle**: por pedido explícito (auditoría de seguridad,
> 2026-06-10) este spec es deliberadamente más detallado a nivel de código que un
> spec normal del proyecto. La regla "el spec dice qué, no cómo" se relaja acá a
> propósito: toda información que ayude a una sesión futura a resolver esto está
> incluida. La sección 5 incluye una lista de **lectura obligatoria** para que la
> sesión que implemente recupere el contexto del código vivo por su cuenta.

## 1. Contexto y motivación

El monto que se le cobra al turista en el checkout **lo calcula el navegador del
cliente y el server confía en ese cálculo**. Concretamente: la página de checkout
carga los precios autoritativos desde la base de datos (`getTourPricing`), pero los
pasa al componente de cliente, que los reenvía en un campo oculto del formulario; el
Server Action vuelve a leer ese precio del formulario y con él arma el monto del
cobro y el payment intent de OnvoPay.

Como el formulario es controlado por el cliente, un atacante edita el campo de
precios (DevTools o un POST directo al Server Action) y **reserva cualquier tour por
el monto que quiera**. El pago a OnvoPay se emite por ese monto manipulado, el
turista paga (p. ej.) 1 centavo, y la reserva se confirma normalmente.

Esto afecta directamente al **operador** (pérdida de ingresos / fraude) y es
explotable por cualquier visitante anónimo del portal público, sin autenticación.

**Por qué la validación de monto del spec 0014 NO lo atrapa**: el 0014 compara el
monto que OnvoPay reporta como pagado contra `payments.amount_cents`. Pero
`payments.amount_cents` se escribió **a partir del mismo precio manipulado** en el
checkout. El atacante paga exactamente lo que el sistema "espera" (porque él fijó
ambos), así que la comparación da verde. El 0014 garantiza coherencia entre la
pasarela y nuestra fila de pago; **no** garantiza que esa fila refleje el precio real
del tour. Este spec cierra esa brecha: el precio real nunca debe salir de la
autoridad del server.

## 2. Objetivos

- Calcular el monto a cobrar **exclusivamente en el server**, a partir de la tabla
  `tour_pricing` autoritativa, resuelta por la instancia que se está reservando.
- Ignorar por completo cualquier precio (o monto) que provenga del cliente: el
  cliente solo aporta qué instancia reserva y cuántos tickets de cada tipo.
- Validar server-side las cantidades de tickets (enteros, dentro de un rango) y que
  cada tipo de ticket pedido tenga un precio activo para ese tour.
- Mantener intacta la experiencia: el navegador puede seguir mostrando el total
  estimado para UX, pero ese número no influye en el cobro.

## 3. Fuera de alcance

- No se cambia la pasarela ni el flujo del widget de OnvoPay (spec 0006), salvo el
  origen del monto que se le pasa a `createPaymentSession`.
- No se cambia la validación de monto del webhook/reconciliador (spec 0014): sigue
  vigente como segunda línea de defensa y queda **reforzada** porque ahora compara
  contra un `payments.amount_cents` confiable.
- No se rediseña el modelo de precios estacionales (`valid_from`/`valid_until`,
  `season_label`): se **reusa** la misma lógica de selección que ya aplica
  `getTourPricing`.
- No se agrega un descuento/cupón ni precios dinámicos: el precio sigue saliendo de
  `tour_pricing` tal cual hoy.
- No se construye UI nueva en el panel.

## 4. Historias de usuario

> Como operador, quiero que el monto que se cobra por una reserva lo determine
> siempre el sistema a partir de mis precios configurados, para que ningún cliente
> pueda pagar menos (ni más) de lo que cuesta el tour manipulando el navegador.

Criterios de aceptación:

- [ ] El monto del cobro y el de `payments.amount_cents` se calculan en el server con
      precios leídos de `tour_pricing` para el `tour_id` de la instancia reservada,
      aplicando el mismo filtro de vigencia (`active=true` + ventana
      `valid_from`/`valid_until`) que usa el portal público.
- [ ] Un POST al Server Action con un campo de precios manipulado (más barato, más
      caro, negativo, o ausente) **no cambia** el monto cobrado: se usa el precio del
      server. Idealmente el Server Action ni siquiera acepta un campo de precios.
- [ ] Si la instancia no existe o no es reservable, la reserva se rechaza sin crear
      hold/booking/payment. Esta validación ya la provee `create_hold_atomic`
      (`HOLD_INSTANCE_NOT_FOUND` / `HOLD_INSTANCE_UNAVAILABLE` / `HOLD_INSTANCE_PAST`);
      el fix no debe debilitarla.
- [ ] La descripción que se envía a OnvoPay (`tour_name`) se resuelve server-side desde
      el tour de la instancia; el cliente no puede fijarla. El campo `tour_name` deja de
      leerse del formulario.
- [ ] Si un tipo de ticket pedido (con cantidad > 0) no tiene precio activo para el
      tour, la reserva se rechaza con error genérico (no se cobra 0 por ese tipo).
- [ ] Las cantidades se validan server-side: enteros ≥ 0, total > 0, y un tope máximo
      por reserva (definido en este spec); valores fuera de rango → error.
- [ ] El total final sigue siendo > 0 (regla existente) y se cobra en la misma moneda
      configurada.

## 5. Diseño técnico

### 5.0 Lectura obligatoria antes de tocar código (recuperá el contexto vos mismo)

Este spec documenta el estado del código al **2026-06-10**. Las líneas exactas
pueden haber cambiado. La sesión que implemente DEBE, antes de escribir nada, abrir
y releer estos archivos para confirmar el flujo y la causa raíz por su cuenta:

1. `web/components/public/CheckoutForm/CheckoutForm.tsx` — fijate en el
   `<input type="hidden" name="pricing" value={JSON.stringify(...)} />`. Ese es el
   canal por el que el precio viaja del server al cliente y vuelve manipulable.
2. `web/lib/booking/checkout-action.ts` — el Server Action: lee `formData.get('pricing')`,
   hace `JSON.parse`, y llama `calculateTotalCents(...)` y luego `initCheckout(...)`
   pasándole ese `pricing`. Confirmá que el precio que entra al cobro proviene del
   form, no de la DB.
3. `web/lib/booking/create.ts` — `initCheckout` recalcula `calculateTotalCents(quantities, pricing)`
   con el `pricing` recibido, inserta el `booking.total_amount_cents`, llama
   `provider.createPaymentSession({ amountCents })`, e inserta `payments.amount_cents`.
   Acá es donde el monto manipulado se materializa en DB y en OnvoPay.
4. `web/lib/public/tours.ts` — `getTourPricing(tourId)`: la fuente autoritativa. Mirá
   el filtro de vigencia: `.eq('active', true)` + `.or('valid_from.is.null,and(valid_from.lte.<today>,valid_until.gte.<today>)')`.
   Esta es la lógica que hay que reusar para el cálculo server-side. Notá que devuelve
   filas con `ticket_type` y `price_usd`.
5. `web/app/[locale]/(public)/tours/[id]/checkout/page.tsx` — cómo se resuelve hoy el
   tour por slug y la instancia por `searchParams.instance`; el server YA tiene los
   precios acá, pero los entrega al cliente.
6. `supabase/migrations/20260527000012_create_bookings.sql` — el esquema de `bookings`
   y `payments` (`total_amount_cents > 0`, `amount_cents > 0`), y `confirm_booking`.
7. `supabase/migrations/20260524000010_create_tour_instances.sql` y el de
   `tour_pricing` (`20260523000005`) — relación `tour_instances.tour_id → tours.id` y
   columnas de `tour_pricing` (`ticket_type`, `price_usd`, `active`, `valid_from`,
   `valid_until`).
8. Verificá si `createHold`/`create_hold_atomic` (`web/lib/booking/availability.ts`,
   `supabase/migrations/20260526000011_create_tour_holds.sql`) valida que la instancia
   sea reservable (status, fecha futura) o solo capacidad; eso decide cuánta
   validación de instancia hay que sumar acá.

### 5.1 Causa raíz (resumen)

El precio cruza la frontera de confianza: nace autoritativo en el server, se serializa
al cliente para UX, y el server lo vuelve a aceptar como input para el cobro. Todo
input del cliente es manipulable; por lo tanto el precio efectivo es controlado por el
atacante. La corrección es estructural: el cliente nunca debe poder influir en el
monto; el server lo recomputa desde la DB en el momento de iniciar el checkout.

### 5.2 Explotación (prueba de concepto)

1. El atacante abre `/es/tours/<slug>/checkout?instance=<uuid>` (instancia real).
2. En DevTools, edita el `<input name="pricing">` a, por ejemplo,
   `[{"ticket_type":"adult","price_usd":0.01}]`, o arma un POST directo al Server
   Action con ese `pricing` y `adult=1`.
3. El Server Action calcula `totalCents = 1`, crea el booking con
   `total_amount_cents = 1` y el payment intent de OnvoPay por 1 centavo.
4. El atacante paga 1 centavo con una tarjeta real. OnvoPay emite
   `payment-intent.succeeded` con `amount = 1`.
5. El webhook (0014) compara `1 === payments.amount_cents (1)` → coincide → confirma.
   El atacante tiene su reserva confirmada habiendo pagado 1 centavo.

### 5.3 Remediación

**Principio**: el cliente envía únicamente `instance_id` y las cantidades por tipo de
ticket. El monto se calcula en el server. Se elimina el campo `pricing` del formulario
y el parámetro `pricing` de `initCheckout`.

Cambios concretos:

- **`CheckoutForm.tsx`**: eliminar el `<input type="hidden" name="pricing">`. El
  componente puede seguir recibiendo `pricing` como prop **solo para mostrar** el
  desglose y el total estimado (UX); ese valor no se envía. Los campos que sí se
  envían: `instance_id` y las cantidades (`adult`/`child`/`student`). `tour_name` ya
  no debería usarse para nada sensible (ver más abajo).
- **`checkout-action.ts`**: dejar de leer `pricing` del `formData`. Validar y
  parsear cantidades server-side (ver 5.4). Pasar a `initCheckout` solo `instanceId` y
  `quantities` (más datos del cliente: nombre, email).
- **`create.ts` (`initCheckout`)**: recibir `instanceId` + `quantities` (sin
  `pricing` ni `tourName`). Dentro:
  1. Resolver la instancia y su tour: `SELECT id, tour_id, ... FROM tour_instances WHERE id = instanceId`.
     Esto cumple dos funciones: obtener `tour_id` para el precio, y confirmar que la
     instancia existe. **No hace falta reimplementar la validación de "reservable"**:
     `create_hold_atomic` (migración `20260526000011`) ya la hace de forma atómica y
     con lock — lanza `HOLD_INSTANCE_NOT_FOUND` si no existe,
     `HOLD_INSTANCE_UNAVAILABLE` si `status <> 'available'`, y `HOLD_INSTANCE_PAST` si
     `starts_at <= NOW()`. El checkout llama `createHold` igual que hoy y esos errores
     ya se traducen a la UI. Lo único nuevo es resolver el `tour_id` para el precio.
  2. Cargar el precio autoritativo del tour aplicando la **misma lógica de vigencia que
     `getTourPricing`** (`active = true` + ventana `valid_from`/`valid_until`). **No
     llamar a `getTourPricing` tal cual desde este flujo**: esa función usa
     `createSupabasePublicClient` (cliente anónimo) y `initCheckout` corre con service
     client (create.ts). Factorizar **solo la construcción del filtro de vigencia** en
     un helper de `web/lib/` reutilizable por ambos (portal público y checkout), y
     aplicarlo con el cliente que cada caller ya usa; no duplicar la cadena
     `.eq('active',true).or('valid_from.is.null,and(...)')` a mano. Construir el
     `priceMap` desde las filas resultantes.
  3. Para cada tipo con cantidad > 0, exigir que exista `price_usd` activo; si falta,
     abortar (no cobrar 0).
  4. Calcular `totalAmountCents` con `calculateTotalCents(quantities, pricingDeDB)`.
     `calculateTotalCents` se conserva tal cual pero ahora recibe SIEMPRE precios de
     la DB.
  5. Continuar como hoy: `createHold` (que revalida reservabilidad atómicamente),
     insert `bookings`, `createPaymentSession`, insert `payments`. El
     `total_amount_cents` y el `amountCents` del intent salen del cálculo autoritativo.
- **`tour_name` / descripción de OnvoPay (se corrige en este spec, no es opcional)**:
  hoy `tourName` viene del cliente (`formData.get('tour_name')` en checkout-action.ts y
  el `<input hidden name="tour_name">` en CheckoutForm.tsx) y se usa como `description`
  del payment intent (create.ts → `createPaymentSession`), que aparece en
  recibos/dashboard de OnvoPay. Quitar el campo del formulario y del Server Action, y
  resolver el nombre del tour server-side desde el tour de la instancia (el mismo
  `SELECT` del paso 1 puede traer `tours.name_es/name_en`). Bajo riesgo (es cosmético),
  pero se corrige acá por higiene: el cliente no debe poder escribir la descripción del
  cobro. Ver criterio de aceptación correspondiente en la sección 4.

### 5.4 Validación de cantidades (server-side)

Hoy `checkout-action.ts` hace `Math.max(0, parseInt(...))` por tipo, sin tope superior
(el `max={20}` es solo del HTML, no se valida en el server). Agregar:

- Cada cantidad: entero, ≥ 0. `parseInt` con base 10; rechazar `NaN`.
- Total de tickets: > 0 y ≤ un tope por reserva. **`MAX_TICKETS_PER_BOOKING = 10`**
  (decisión de Kenneth, 2026-06-10). Definir la constante en un módulo de `web/lib/`
  (no en `@shared` si el worker no la necesita; el worker no participa del checkout).
  Bajar también el `max` del `<input>` de cantidades en `CheckoutForm.tsx` de 20 a 10
  para que el límite del HTML quede consistente con el tope server-side (el server es la
  autoridad; el HTML es solo UX).
- Si se excede el tope o el total es 0, error genérico (sin crear nada).

Esto además acota el abuso de inventario (un solo POST no puede pedir cantidades
absurdas); el rate limiting de reservas repetidas se trata aparte en el spec 0017.

### 5.5 (Opcional, defensa en profundidad) Guard de precio en DB

Como capa extra, se puede mover el cálculo del total a una función SQL
`SECURITY DEFINER` que reciba `instance_id` + cantidades y devuelva/aplique el total
desde `tour_pricing`, dejando el monto completamente fuera del alcance de la capa de
aplicación. **No es obligatorio** para cerrar la vulnerabilidad (basta con calcular en
el server y no aceptar precio del cliente) y agrega complejidad. Se documenta como
opción; decisión en Preguntas abiertas.

> **Decisión (2026-06-10): NO se adopta ahora.** Se implementa únicamente la corrección
> de capa de aplicación (5.3), que cierra C-1 al 100%. Criterio: la opción más segura
> contra el ataque real y la menos propensa a introducir otros problemas (sin migración,
> sin `SECURITY DEFINER`/grants nuevos, blast radius acotado a `web/`). Esta función SQL
> queda documentada como mejora futura **puramente aditiva**: se puede agregar después
> sin tocar la corrección de 5.3, si en algún momento se quiere blindar contra un caller
> que arme el monto por su cuenta.

## 6. Modelo de datos

Sin cambios al schema en la versión mínima (recomendada): la corrección es de capa de
aplicación. `bookings.total_amount_cents` y `payments.amount_cents` ya tienen
`CHECK (> 0)`.

Si se adopta la opción 5.5 (defensa en profundidad), se agregaría una función
`public.compute_booking_total(uuid, int, int, int)` `SECURITY DEFINER` +
`SET search_path=''` + `REVOKE EXECUTE FROM PUBLIC`, en una migración nueva
(`supabase/migrations/<timestamp>_compute_booking_total.sql`). Queda condicionado a la
decisión de Preguntas abiertas.

## 7. Estados y transiciones

No aplica. No se introduce ni modifica ninguna máquina de estados; el ciclo de la
reserva (`pending_payment → confirmed`) es idéntico.

## 8. Casos borde y errores

- **`pricing` ausente o vacío en el POST**: ya no se lee; irrelevante. El monto sale de
  la DB.
- **Instancia inexistente o de otro tour**: abortar antes de crear hold/booking/payment.
- **Tipo de ticket sin precio activo** (p. ej. el tour no vende `student`, pero el POST
  pide `student=2`): abortar (no cobrar 0 por ese tipo). Hoy `calculateTotalCents`
  trata el precio faltante como 0 — eso debe convertirse en error cuando la cantidad de
  ese tipo es > 0.
- **Precios estacionales en transición** entre el render de la página y el submit: se
  usa el precio vigente **al momento del submit** (recálculo server-side). Aceptable y
  correcto (es el precio real en ese instante).
- **Cantidad negativa, no numérica o sobre el tope**: error genérico, sin efectos.
- **Total = 0 tras recálculo**: ocurre si todas las cantidades son 0 (ya cubierto por el
  guard de cantidades) o si el precio configurado es 0. **El modelo no contempla tours
  gratis**: un `tour_pricing.price_usd = 0` activo es un error de datos, no un flujo
  soportado (chocaría además con `CHECK total_amount_cents > 0` / `amount_cents > 0`). El
  checkout aborta con error genérico ante total 0; no se intenta "vender gratis".
- **Carrera con cambio de precio por el admin**: si el admin edita `tour_pricing`
  mientras un turista está en el checkout, el cobro usa el precio vigente al submit. No
  hay inconsistencia: el booking y el payment se crean con el mismo total recalculado.
- **Instancia llena**: sin cambios; `create_hold_atomic` sigue devolviendo
  `HOLD_NO_CAPACITY` → la UI muestra "sin disponibilidad".

## 9. Impacto en otras áreas

- **Checkout (0006)**: cambia el origen del monto; el resto del flujo (hold, widget,
  webhook) es igual.
- **Validación de monto (0014)**: no cambia su código, pero **gana solidez**: ahora
  compara contra un `payments.amount_cents` confiable. Conviene mencionarlo en el
  changelog de 0014 como refuerzo retroactivo.
- **Reportes (0012)**: indirectamente más confiables (los ingresos ya no pueden ser
  envenenados por precios manipulados).
- **i18n**: si se agregan mensajes de error nuevos (p. ej. "tipo de ticket no
  disponible"), textos ES/EN. Si se reusa el error genérico existente, sin cambios.
- **Panel / worker / emails**: sin impacto.

## 10. Plan de tests

- **Unit (web)**: `calculateTotalCents` con precios de DB (ya existe; mantener).
  Nueva: la validación de cantidades (enteros, tope, total > 0) — casos válidos e
  inválidos.
- **Unit (web)**: la resolución de precio autoritativo dado un set de filas de
  `tour_pricing` y cantidades, incluyendo el caso "tipo pedido sin precio activo → error".
- **Integración (web)** contra DB real (este es el test que prueba el fix):
  - Sembrar un tour con `tour_pricing` conocido (p. ej. adulto $50). Invocar el Server
    Action / `initCheckout` **simulando un cliente que envía un precio manipulado**
    (o sin precio) y verificar que el `booking.total_amount_cents` y el
    `payments.amount_cents` resultantes corresponden al precio de la DB ($50×cantidad),
    **no** al manipulado. Este test es la regresión que demuestra que C-1 está cerrado.
  - Pedir un tipo de ticket sin precio activo → no se crea booking ni payment.
  - Instancia inexistente / de otro tour → no se crea nada.
- **Casos borde obligatorios (dinero)**: precio manipulado a la baja, a la alza,
  negativo, y ausente — todos deben resultar en el monto autoritativo.
- **Manual (PR)**: contra el sandbox de OnvoPay, repetir la PoC de 5.2 (editar el form)
  y confirmar que el intent se crea por el precio real, no por el manipulado.

## 11. Plan de rollout

- **Feature flag**: no. Es un fix de seguridad, debe aplicar a todos siempre.
- **Migración de datos**: ninguna en la versión mínima. Las reservas históricas no se
  tocan. (Recomendado, fuera de este spec: una consulta de auditoría puntual para
  detectar si ya existen bookings con `total_amount_cents` sospechosamente bajos
  respecto al precio actual del tour — posible explotación previa.)
- **Reversible**: sí, revirtiendo el commit. Pero NO debería revertirse: reabre la
  vulnerabilidad.
- **Orden**: independiente de los otros specs de seguridad (0016, 0017). Es el de mayor
  prioridad; idealmente se mergea y despliega primero.
- **Comunicación**: si la auditoría puntual detecta explotación previa, evaluar con el
  cliente las reservas afectadas.

## 12. Métricas de éxito

- 0 reservas creadas con `total_amount_cents` distinto del precio autoritativo de
  `tour_pricing` para su instancia (verificable con una consulta que recompute el total
  esperado y lo compare contra lo cobrado).
- El test de integración de regresión (precio manipulado → monto autoritativo) pasa en
  verde y queda en la suite para prevenir reintroducción.

## 13. Preguntas abiertas

- [x] **Pregunta**: ¿Se implementa la defensa en profundidad de 5.5 (cálculo del total
      en una función SQL `SECURITY DEFINER`), o basta con el cálculo server-side en la
      capa de aplicación? **Dueño**: Kenneth **Antes de**: aprobar el spec.
      **Resuelto (2026-06-10): solo capa de aplicación (5.3).** Criterio del usuario: la
      opción más segura y menos propensa a causar otros problemas. La corrección de capa de
      aplicación cierra C-1 al 100% sin migración ni `SECURITY DEFINER`/grants nuevos (menor
      blast radius). El guard SQL de 5.5 queda como mejora futura puramente aditiva.
- [x] **Pregunta**: ¿Valor definitivo de `MAX_TICKETS_PER_BOOKING`? Propuesto: 20 (igual
      al `max` del HTML). **Dueño**: Kenneth **Antes de**: aprobar el spec.
      **Resuelto (2026-06-10): `MAX_TICKETS_PER_BOOKING = 10`.** Tope más conservador que el
      `max={20}` del HTML actual; se baja también el `max` del input a 10 para consistencia
      (ver 5.4).
