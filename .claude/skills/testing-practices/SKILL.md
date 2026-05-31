---
name: testing-practices
description: Prácticas profesionales de testing para booking-platform. Aplicar siempre que se vaya a escribir, modificar, revisar o eliminar tests; cuando se implemente lógica de negocio que requiera cobertura; cuando se diseñe una feature y se piense en su plan de tests; cuando un test esté fallando intermitentemente y haya que diagnosticarlo. Cubre estructura (unit/integration/e2e), patrón AAA, naming, fixtures, factories, cobertura por criticidad, casos borde obligatorios para lógica crítica (concurrencia, idempotencia, máquinas de estado), uso de mocks, prohibiciones (tests frágiles, mocks de DB, asserts inespecíficos), y reglas para tests del worker y de webhooks. No mergear código de lógica de negocio sin haber consultado esta skill.
---

# Testing practices — pruebas profundas y profesionales

Esta skill define cómo se prueba el código en este proyecto. La regla general: **un sistema de reservas que cobra dinero real no se mergea sin tests profundos en la lógica crítica**. Esto no es opcional.

## Stack y herramientas

- **Vitest** para unit tests e integration tests. Rápido, compatible con ESM, con buena experiencia de developer.
- **Playwright** para tests end-to-end cuando se necesiten (no en el MVP inicial; planificado a partir de la feature de checkout completo).
- **Testing Library** (`@testing-library/react`) para tests de componentes React.
- **MSW** (Mock Service Worker) para interceptar requests HTTP a servicios externos durante tests.
- **`@faker-js/faker`** para generar datos pseudo-aleatorios en factories.
- **Supabase local** vía Docker para tests de integración contra Postgres real.

## La pirámide de tests en este proyecto

```
        ┌─────────────────┐
        │   e2e (pocos)   │   ← flujos críticos de usuario punta a punta
        ├─────────────────┤
        │  integration    │   ← lógica de negocio + DB real, webhooks, jobs
        ├─────────────────┤
        │      unit       │   ← funciones puras, validaciones, helpers
        └─────────────────┘
```

La proporción aproximada que esperamos en el repo maduro: 70% unit, 25% integration, 5% e2e. El motivo de la inversión clásica: los tests unit son baratos, rápidos y dan feedback inmediato; los e2e son caros, lentos y frágiles. Cada nivel cubre lo que el anterior no puede.

### Cuándo escribir cada tipo

**Unit tests**:
- Funciones puras de lib (cálculos de precios, validadores, transformaciones, helpers de fecha).
- Schemas Zod (que el schema acepte/rechace lo que debe).
- Funciones de máquina de estado (transiciones permitidas y prohibidas).
- Helpers de UI sin DOM (formatters, reducers).
- **No usar DB, no usar red, no usar disco**. Si tu unit test necesita uno de esos, es integration test.

**Integration tests**:
- Server actions y API routes completas, incluyendo validación, lógica de negocio y persistencia.
- Repositories contra la DB real (concurrencia, constraints, RLS).
- Jobs del worker contra DB real.
- Handlers de webhooks de la pasarela contra DB real (con la pasarela mockeada).
- Cualquier flujo que cruce dos o más capas (validación + lógica + DB).

**E2E tests**:
- Flujos punta a punta críticos del producto, ejecutados en un navegador real contra el sistema completo levantado.
- En el MVP, candidatos a e2e son: reservar un tour como turista, cancelar con reembolso automático, login de operador.
- No usar e2e para casos borde. Para eso están los integration tests.

## Ubicación y naming

### Ubicación

```
web/lib/booking/state.ts
web/lib/booking/state.test.ts              ← unit, junto al código

web/tests/integration/booking-flow.test.ts ← integration, en carpeta separada
web/tests/integration/webhook-stripe.test.ts

web/tests/e2e/reservar-tour.spec.ts        ← e2e con Playwright, .spec.ts
```

Worker tiene su propia carpeta de tests:

```
worker/jobs/send-notifications.ts
worker/jobs/send-notifications.test.ts     ← unit del job
worker/tests/integration/notifications.test.ts ← integration con DB
```

### Naming

Cada `describe` corresponde a una unidad coherente:

```typescript
describe('BookingStateMachine', () => {
  describe('transition from pending_payment', () => {
    it('moves to confirmed when payment succeeds', () => { ... });
    it('moves to payment_failed when payment is declined', () => { ... });
    it('rejects transition to checked_in', () => { ... });
  });
});
```

Reglas:

- `describe` usa el nombre del módulo/clase/comportamiento (sustantivo).
- `it` empieza con verbo en tercera persona indicativo (en inglés o español; ser consistente dentro del archivo). Describe **qué se espera, no qué se hace internamente**.
- Mal: `it('llama a updateStatus con confirmed')` — describe la implementación.
- Bien: `it('confirms the booking when payment succeeds')` — describe el comportamiento.
- Evitar nombres genéricos como `it('works')`, `it('does the thing')`, `it('test 1')`.

## El patrón AAA

Todo test sigue **Arrange-Act-Assert** con separación visual clara:

```typescript
it('refunds the booking when cancelled with more than 24h notice', async () => {
  // Arrange
  const booking = await BookingFactory.create({
    status: BookingStatus.Confirmed,
    tourStartTime: addHours(new Date(), MIN_HOURS_FOR_REFUND + 1),
    totalCents: 8000,
  });

  // Act
  const result = await cancelBooking({ bookingId: booking.id, actor: ActorType.Customer });

  // Assert
  expect(result.status).toBe(BookingStatus.CancelledRefunded);
  expect(result.refundedCents).toBe(8000);
  expect(stripeMock.refunds.create).toHaveBeenCalledOnce();
});
```

- **Arrange**: prepará el estado y los datos.
- **Act**: ejecutá la operación bajo prueba. Idealmente una sola línea.
- **Assert**: verificá. Múltiples expects son OK si todos pertenecen al mismo comportamiento.

Tests sin separación AAA son difíciles de leer. Si tu test no encaja en AAA, probablemente está probando dos cosas y debería partirse.

## Fixtures y factories

### Factories

Para crear objetos de dominio en tests, usar **factories tipadas** con valores por defecto razonables y overrides parciales:

```typescript
// web/tests/factories/booking.factory.ts
import { faker } from '@faker-js/faker';
import { BookingStatus } from '@/shared/constants/booking';
import type { Booking } from '@/shared/types';

export const BookingFactory = {
  build(overrides: Partial<Booking> = {}): Booking {
    return {
      id: faker.string.uuid(),
      tourInstanceId: faker.string.uuid(),
      customerEmail: faker.internet.email(),
      customerName: faker.person.fullName(),
      status: BookingStatus.PendingPayment,
      totalCents: faker.number.int({ min: 1000, max: 50000 }),
      currency: Currency.USD,
      createdAt: new Date(),
      ...overrides,
    };
  },

  async create(overrides: Partial<Booking> = {}): Promise<Booking> {
    const booking = this.build(overrides);
    return await bookingsRepo.insert(booking);
  },
};
```

Las factories tienen `build` (objeto en memoria) y `create` (objeto persistido). Usar el que corresponda según el tipo de test.

### Fixtures

Para datos fijos compartidos (un operador "Tours Demo", tour "Birdwatching Monteverde" usado en muchos tests), usar fixtures en `web/tests/fixtures/`:

```typescript
// web/tests/fixtures/operators.ts
export const FIXTURE_OPERATOR_DEMO = {
  id: '00000000-0000-7000-8000-000000000001',
  name: 'Tours Demo',
  slug: 'tours-demo',
  stripeAccountId: 'acct_test_demo',
} as const;
```

Fixtures se cargan al inicio de cada suite de integration con un helper `seedFixtures()` que las inserta en la DB de test.

## Cobertura por criticidad

No hay un porcentaje global de cobertura mínimo. La regla es por dominio:

| Dominio | Nivel exigido | Justificación |
|---|---|---|
| Booking (creación, estado, concurrencia) | **Crítico** — cubrir todos los caminos y casos borde | Si rompe, se vende un cupo de más o se duplica una reserva |
| Payments (pagos, refunds, webhooks) | **Crítico** | Si rompe, se pierde plata o se cobra de más |
| Notifications (envío, cancelación de pendientes) | **Alto** — cubrir todos los happy paths y los modos de fallo conocidos | Si rompe, el cliente no recibe info crítica |
| Auth de operadores | **Alto** | Implicancia de seguridad |
| Tour management (CRUD de tours, schedules) | **Medio** | Si rompe, el operador lo nota y reporta |
| UI components | **Bajo** — cubrir solo lo no trivial | Tests de componentes son frágiles; preferir e2e para flujos |
| i18n, helpers de formato | **Medio** | Funciones puras fáciles de probar |

"Crítico" significa: cada función tiene al menos un test del happy path, todos los caminos condicionales tienen tests, y todos los casos borde de la sección siguiente están cubiertos.

## Casos borde obligatorios para lógica crítica

Cuando trabajes con lógica que entra en la categoría "crítica" (booking, payments, notifications), los siguientes casos **deben estar cubiertos por tests, sin excepción**.

### Concurrencia

- Dos clientes intentan reservar el último cupo al mismo tiempo: solo uno gana, el otro recibe `BOOKING_CAPACITY_EXCEEDED`.
- Un cliente reserva y un operador edita la capacidad del tour al mismo tiempo: no se rompe el invariante `capacity_reserved <= capacity_total`.
- Dos webhooks idénticos de la pasarela llegan en paralelo: solo se procesa uno.

### Idempotencia

- El mismo webhook procesado dos veces produce el mismo resultado.
- El mismo recordatorio enviado dos veces no manda dos emails (el segundo intento ve que ya está `sent` y no actúa).
- Un refund pedido dos veces no devuelve plata dos veces.

### Máquinas de estado

- Cada transición permitida tiene un test que la ejerce.
- Cada transición prohibida tiene un test que verifica que se rechaza con error claro.
- Los estados terminales no pueden salirse: tests que intenten transicionar y verifiquen el rechazo.

### Validación de entrada

- Inputs vacíos, nulos, undefined.
- Strings con longitudes en el límite (mínimo, máximo, mínimo - 1, máximo + 1).
- Tipos incorrectos (números donde se espera string, etc.).
- Caracteres especiales (apóstrofes, emojis, unicode).
- Inyecciones SQL en strings.

### Tiempo y fechas

- Tour en el pasado: no se puede reservar.
- Tour exactamente en el límite de 24h: behavior documentado (incluido o excluido).
- Cancelación exactamente en el límite de la ventana de refund.
- Cambios de daylight saving: tours que cruzan el cambio.
- Diferentes zonas horarias del cliente y del operador.

### Falla de servicios externos

- La pasarela devuelve error 500: el sistema retorna error claro al usuario y no deja booking en estado inconsistente.
- Resend devuelve error: notificación queda en `pending` para retry, no se pierde.
- DB no disponible: errores propagados correctamente, sin estados parciales.

## Mocks: qué sí, qué no

### Mocks permitidos

- **Servicios externos por HTTP**: pasarelas de pago (OnvoPay, futuras), Resend, otras. Usar MSW para interceptar requests.
- **Reloj del sistema**: `vi.useFakeTimers()` para tests sensibles a tiempo.
- **Loggers**: para verificar que se loggeó lo correcto sin ensuciar stdout.
- **Variables de entorno**: con un setup file por suite que las controla.

### Mocks prohibidos

- **DB**. Los tests de integración corren contra Postgres real (Supabase local). Mocks de DB se desfasan del schema, no detectan bugs reales de SQL, y dan falsa seguridad. Si tu test "necesita" mockear la DB, probablemente debería ser un unit test sobre una función pura, no un integration test.
- **Repositories propios**. Si tu test mockea un repository en lugar de ir a DB real, el test está acoplado a la implementación del repository, no al comportamiento del sistema.
- **Funciones internas de la misma capa**. Si en tu test estás haciendo `vi.spyOn(myModule, 'helperFunction')`, probablemente estás probando implementación en lugar de comportamiento.

### Reglas para usar mocks bien

- Configurá el mock en `beforeEach` y resetealo en `afterEach`. Nunca dejes estado de mock entre tests.
- Verificá las **llamadas significativas** al mock, no todas. `expect(stripeMock.refunds.create).toHaveBeenCalledWith({ payment_intent: pi, amount: 8000 })` está bien; `expect(stripeMock.refunds.create).toHaveBeenCalled()` solo es útil cuando lo único que importa es que se haya llamado.
- Si un test tiene más líneas de setup de mocks que de Act + Assert juntos, está mal abstraído. Considerá un helper.

## Tests del worker

Los jobs del worker requieren tests específicos:

- **Test unit del cálculo** que decide qué procesar (sin tocar DB).
- **Test de integración** que carga datos en DB, ejecuta el job una vez, y verifica el estado final.
- **Test de idempotencia**: ejecutar el job dos veces seguidas y verificar que el resultado es el mismo.
- **Test de fallo + retry**: forzar fallo del servicio externo, verificar que el job marca para retry; en un segundo run con el servicio respondiendo OK, verificar que el job lo procesa.
- **Test de cancelación**: cuando una booking se cancela, el recordatorio pendiente no se envía.

## Tests de webhooks de pasarela

Los webhooks de pasarelas de pago (OnvoPay en MVP, PayPal y otras post-MVP) tienen requisitos especiales que aplican igual independiente del proveedor:

- **Verificación de firma**: test que rechaza un webhook con firma inválida. Cada pasarela tiene su mecanismo (HMAC con secret, en general); el test debe usar el mecanismo real del adaptador.
- **Idempotencia**: test que envía el mismo `event.id` (o equivalente del proveedor) dos veces y verifica que se procesa una sola vez. Se aprovecha la tabla `processed_webhook_events`.
- **Eventos desconocidos**: test que confirma que un `event.type` no manejado devuelve 200 sin error (no es nuestro trabajo procesarlo, pero tampoco fallar; el proveedor reintentaría innecesariamente).
- **Estados inconsistentes**: webhook de "pago exitoso" para una booking que ya está en estado `cancelled_refunded`. Verificar que no se hace nada raro (no se cambia el estado, no se manda email duplicado).
- **Pasarela apropiada**: el handler verifica que el evento viene del proveedor declarado en `payments.external_provider` para esa booking. No procesar un webhook de PayPal para un pago marcado como OnvoPay.

## Velocidad de los tests

- **Unit tests**: cada uno debe correr en <50ms. El suite completo de unit no debería tardar más de 30 segundos.
- **Integration tests**: cada uno <2 segundos. Suite completo <3 minutos.
- **E2E tests**: cada uno <30 segundos. Suite acotado a 5-10 tests críticos.

Si un test tarda más de lo esperado, investigá: probablemente está haciendo I/O innecesario, está en la capa equivocada, o tiene un `await` que no debería tener.

## Tests determinísticos

Tests intermitentes ("flaky") son peor que no tener tests. Reglas:

- **No `Math.random()` directo en código probado** sin posibilidad de seed. Si el código necesita aleatoriedad, inyectarla como dependencia.
- **No fechas reales** en tests. Usar fake timers o inyectar el clock.
- **No esperar tiempos arbitrarios** (`setTimeout` para "darle tiempo al worker"). Usar promesas que resuelven cuando el evento esperado ocurre.
- **No depender del orden de tests**. Cada test es independiente y puede correr aislado.
- **Cleanup entre tests**: la DB de test se trunca/reseed entre cada test de integración. El estado de mocks se resetea entre cada unit test.

Si un test falla intermitentemente, **arreglar es prioridad alta**. Si no se puede arreglar inmediatamente, **deshabilitarlo con un comentario que cite el spec donde se documenta** la causa raíz, no ignorarlo y dejarlo "salteado" para siempre.

## Tests legibles

Los tests son documentación viva del comportamiento esperado. Reglas:

- Cada test, leído solo, debe explicar qué comportamiento se está verificando.
- Si necesitás un comentario para explicar qué hace el test, el test está mal escrito.
- Magic values en tests (`expect(result.amount).toBe(85)`) están permitidos cuando explicitan la expectativa. Si el número es derivado (ej: 24 horas en milisegundos), igual usar constantes del proyecto.
- Mensajes de assert custom cuando el default no es claro: `expect(result.status, 'expected refund completion').toBe(BookingStatus.CancelledRefunded)`.

## Diagnóstico de tests que fallan: causa raíz antes de tocar

Cuando un test falla, **está prohibido modificar el test, su assert o su expectativa hasta haber determinado por qué falla.** Un test rojo es una de tres cosas, y cada una tiene un tratamiento distinto:

1. **Bug en el código** → se arregla el código, NO el test. El test está haciendo su trabajo.
2. **Test obsoleto/incorrecto** → el comportamiento esperado cambió legítimamente (una migración, un spec posterior, una decisión documentada). Recién acá se actualiza el test, y el commit debe citar la fuente que prueba que el nuevo comportamiento es el correcto.
3. **Test frágil** (orden de ejecución, estado compartido, tiempo, paralelismo) → se arregla la fragilidad (aislamiento, `fileParallelism`, fixtures), no el assert.

**El error a evitar:** cambiar el assert para que pase sin entender la causa. Eso puede **enmascarar un bug real** (caso 1) haciéndolo pasar por test obsoleto (caso 2). Son indistinguibles si no se investiga.

**Cómo decidir entre "bug" y "test obsoleto":** contrastar contra la fuente de verdad, no contra la memoria ni la intuición:

- ¿Qué dice el **spec** asociado sobre el comportamiento esperado?
- ¿Qué hacen las **migraciones**, incluyendo las posteriores que pueden revertir una anterior (verificar el orden por timestamp)?
- ¿Cuál es el **comportamiento real en la DB/runtime** ahora mismo (consulta directa, no asunción)?

Si las tres fuentes coinciden en que el nuevo comportamiento es el correcto, es un test obsoleto y se actualiza citando la evidencia. Si no coinciden, o no se pueden verificar, asumir que es un bug del código hasta probar lo contrario.

## Reportar resultados de tests con honestidad

- **Nunca afirmar que un test o suite "pasa" sin haberlo ejecutado en esta sesión.** Si no se corrió (Docker caído, entorno faltante), decir exactamente eso y marcarlo como pendiente.
- **Reportar el conteo real, no el esperado.** "54 de 55 pasan" no es "55 pasan". Si hay una falla, nombrarla y aclarar si es propia o preexistente.
- Si una afirmación previa (un número, un "gotcha") resulta inexacta, **corregirla explícitamente** en vez de borrarla en silencio.
- Antes de declarar una feature "lista para PR", correr la suite completa relevante (unit + integración) y reportar el resultado verificado.

## Anti-patrones de testing

- **Tests que prueban la implementación, no el comportamiento**: `expect(spy).toHaveBeenCalledTimes(3)` cuando lo que importa es que el resultado final sea correcto. Si refactorizás internamente, el test rompe sin que haya un bug real.
- **Asserts vagos**: `expect(result).toBeTruthy()`, `expect(error).toBeDefined()`. Verificá el valor concreto.
- **Setup gigante para un test pequeño**: si tu `beforeEach` ocupa 80 líneas para un test de 5 líneas, algo está fuera de balance.
- **Tests que crecen en cascada**: un test depende del estado dejado por otro. Cada test debe ser independiente.
- **Snapshot testing usado como reemplazo de asserts explícitos**. Snapshots están permitidos para output visual estable; no para verificar lógica.
- **Comentar tests rotos**. Si está roto, se arregla o se borra. Comentado solo acumula deuda.
- **`expect.assertions(n)` para "asegurarse de que se llamaron N asserts"**. Esto pretende cubrir un defecto del test (probablemente lógica condicional dentro del test que debería partirse).
- **Tests sin assert**. Existen. Llaman a una función y no verifican nada. Pasaron CI sin probar nada.
- **Mockear lo que se está probando**. Test de `cancelBooking` que mockea `cancelBooking` para que devuelva success. Risible pero pasa.

## Checklist antes de mergear

Antes de marcar un PR como ready-for-review, verificá:

- [ ] Toda función nueva de lógica de negocio tiene tests.
- [ ] Los casos borde obligatorios para lógica crítica están cubiertos (si aplican).
- [ ] Los tests siguen AAA con separación visual.
- [ ] No hay `it.skip` ni `describe.skip` sin razón documentada.
- [ ] No hay `console.log` olvidados en los tests.
- [ ] `pnpm test` pasa local.
- [ ] El tiempo total del suite no creció desproporcionadamente.

## Skills relacionadas

- **codebase-conventions** — define las reglas generales del código que estos tests prueban.
- **feature-workflow** — la etapa 5 (implementación) incluye los tests; la etapa 10 del spec define el plan de tests.
- **spec-authoring** — la sección 10 del spec documenta qué tests planifica esa feature.
