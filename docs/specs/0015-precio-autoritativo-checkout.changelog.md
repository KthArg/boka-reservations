# Changelog — 0015 Precio autoritativo en el checkout

Spec: [0015-precio-autoritativo-checkout.md](./0015-precio-autoritativo-checkout.md)
Rama: feat/0015-precio-autoritativo-checkout

## 2026-06-10 — Implementación

**Contexto**: fix de C-1 (CRÍTICO). El monto del checkout lo calculaba el navegador
(campo oculto `pricing` del form) y el server confiaba en él → reservar cualquier tour
por 1 centavo. Decisiones del spec: **solo capa de aplicación** (sin guard SQL) y
**`MAX_TICKETS_PER_BOOKING = 10`**.

**Hecho**:

- **`web/lib/pricing/active-filter.ts` (nuevo)**: única fuente del filtro de "precio
  vigente" de `tour_pricing` (`active = true` + ventana `valid_from`/`valid_until`).
  `pricingToday()` + `applyActivePricingFilter(query, today?)`. Lo comparten el portal
  público (`getTourPricing`) y el checkout autoritativo, para que el precio se seleccione
  idéntico en ambos y no pueda derivar.
- **`web/lib/booking/quantities.ts` (nuevo)**: `MAX_TICKETS_PER_BOOKING = 10`,
  `TicketQuantitiesSchema` (Zod: cada tipo entero ≥ 0 y ≤ 10; total > 0 y ≤ 10),
  `parseTicketQuantities(raw)` → `TicketQuantities | null`. Reemplaza el
  `Math.max(0, parseInt(...))` sin tope del Server Action.
- **`web/lib/booking/pricing-math.ts` (nuevo)**: `PricingRow`, `calculateTotalCents`
  (movido tal cual desde `create.ts`, sigue siendo puro y tolerante a precio faltante → 0,
  usado por la UX de `CheckoutForm`) y `computeAuthoritativeTotal(quantities, pricing)`,
  que **convierte en error** el caso "tipo pedido (cantidad > 0) sin precio activo" (no
  cobra 0) y exige total > 0.
- **`web/lib/booking/checkout-pricing.ts` (nuevo)**: `resolveAuthoritativeCharge(db,
instanceId, quantities, locale)` resuelve la instancia → tour (con `tours!inner`),
  carga el precio autoritativo del tour con el filtro de vigencia y devuelve
  `{ tourName, totalAmountCents }`. El `tourName` (descripción del payment intent de
  OnvoPay) también sale del server, no del cliente.
- **`create.ts` (`initCheckout`)**: deja de recibir `pricing` y `tourName`. Recibe
  `instanceId` + `quantities` + datos del cliente + `locale`; recomputa el monto vía
  `resolveAuthoritativeCharge` **antes** de `createHold`; el `total_amount_cents`, el
  `amountCents` del intent y la `description` salen del cálculo autoritativo.
- **`checkout-action.ts`**: deja de leer `pricing` y `tour_name` del `formData`; valida
  cantidades con `parseTicketQuantities`; llama `initCheckout` sin precio ni nombre.
- **`CheckoutForm.tsx`**: se eliminan los `<input hidden name="pricing">` y
  `<input hidden name="tour_name">`. El prop `pricing` queda solo para mostrar el desglose
  (UX); el prop `tourName` se elimina (la página ya lo muestra en su encabezado). `max` del
  input de cantidades baja de 20 a `MAX_TICKETS_PER_BOOKING`.
- **`checkout/page.tsx`**: deja de pasar `tourName` a `CheckoutForm`.
- **`tours.ts` (`getTourPricing`)**: usa `applyActivePricingFilter` en vez de la cadena a
  mano.

**Por qué / decisiones**:

- **El cliente solo aporta `instance_id` + cantidades.** El precio nunca cruza de vuelta la
  frontera de confianza. `calculateTotalCents` se conserva pero ahora SIEMPRE recibe
  precios de la DB.
- **`computeAuthoritativeTotal` separado de `calculateTotalCents`**: el primero es estricto
  (tipo sin precio → error); el segundo se mantiene tolerante para el total estimado de UX
  (donde un tipo sin precio simplemente no suma). Así no se rompen los tests existentes ni
  la UX, y el camino del cobro queda blindado.
- **Reservabilidad sin debilitar**: la existencia/estado/fecha de la instancia la sigue
  validando `create_hold_atomic` (atómico, con lock). `resolveAuthoritativeCharge` solo
  agrega la resolución del `tour_id` para el precio y falla temprano si la instancia no
  existe (antes de crear hold/booking/payment).
- **`MAX_TICKETS_PER_BOOKING` en `web/lib`** (no en `@shared`): el worker no participa del
  checkout (ver memoria worker-no-shared).

**Tests** (suite verde):

- **Unit web (105, +13)**:
  - `lib/booking/quantities.test.ts` (9): `parseTicketQuantities` — válidas, campo ausente
    → 0, total en el tope, total 0 → null, total > tope → null, individual > tope → null,
    negativo → null, no numérico → null, decimal → null.
  - `tests/unit/booking/checkout.test.ts` (+4): `computeAuthoritativeTotal` — total desde la
    DB; tipo pedido sin precio → lanza `CHECKOUT_TICKET_UNAVAILABLE` (no cobra 0); tipo sin
    precio pero cantidad 0 → ok; total 0 (precio 0) → `CHECKOUT_ZERO_AMOUNT`. (Import movido a
    `pricing-math`.)
- **Integración web (112, +3)** — `tests/integration/checkout-price-authority.test.ts` (la
  regresión que demuestra C-1 cerrado): siembra tour con adulto $50; `initCheckout` cobra el
  precio de la DB en `bookings.total_amount_cents` **y** `payments.amount_cents` (el cliente
  ya no tiene cómo pasar un precio); tipo sin precio activo → no crea booking/payment;
  instancia inexistente → no crea nada. Mockea el provider de pago, service client real.
- `public-portal.test.ts` (getTourPricing con el helper de vigencia) sigue verde. Lint 0
  errores, typecheck limpio. **Sin migraciones** (fix de capa de aplicación); worker intacto.

**Pendiente**:

- Manual en el PR: repetir la PoC (editar el form en DevTools) contra el sandbox de OnvoPay
  y confirmar que el intent se crea por el precio real.
- Auditoría puntual (recomendada por el spec, fuera del fix): consulta para detectar bookings
  históricos con `total_amount_cents` anómalamente bajo respecto al precio actual del tour.
- Fuera de alcance (anotado): `listActiveTours` (tours.ts) sigue con su propia cadena de
  vigencia (precio mínimo de display, no parte de la vulnerabilidad); consolidarlo con el
  helper queda como deuda menor para no ampliar el alcance del fix.
