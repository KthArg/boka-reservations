---
name: codebase-conventions
description: Convenciones técnicas y estilo de código para el monorepo booking-platform. Aplicar siempre al escribir, modificar o revisar código en cualquier carpeta del repo (web/, worker/, shared/, migrations/). Incluye reglas de TypeScript, organización de carpetas, manejo de DB, integración con Stripe, plantillas de email, internacionalización, manejo de errores, logging, y tests. Consultar también cuando el usuario pida "agregame X" sin precisar dónde — esta skill define dónde va cada tipo de código.
---

# Codebase conventions — reglas técnicas del repo

Estas convenciones se aplican a todo código escrito en este repositorio. Son decisiones tomadas para mantener consistencia, prevenir clases enteras de bugs y facilitar la colaboración. Donde el lenguaje o el framework ya impone un estándar (TypeScript, Next.js), seguimos ese estándar. Donde queda ambigüedad, esta skill resuelve.

## Principios generales

- **Simple antes que clever**. Código que se entiende en una pasada vale más que código corto pero denso.
- **Single Responsibility**. Cada unidad de código (función, módulo, componente, clase) tiene una sola razón para cambiar. Esta es la regla más importante de este proyecto y se aplica con disciplina:
  - **Funciones**: hacen una cosa y la hacen bien. Si una función necesita un comentario para separar "primero hace X, después hace Y", probablemente son dos funciones.
  - **Módulos**: cada archivo en `lib/` aborda un concepto. `lib/booking/state.ts` maneja transiciones de estado, no envío de emails ni queries de tours.
  - **Componentes React**: un componente representa una unidad visual con una responsabilidad clara. Si un componente recibe 10 props y tiene 4 ramas condicionales grandes, son varios componentes disfrazados de uno.
  - **Server Actions y API routes**: validan input, delegan a lógica de negocio en `lib/`, formatean respuesta. No mezclan responsabilidades.
  - **Test de olfato**: si al describir un archivo o función necesitás usar la palabra "y" para conectar dos cosas no triviales, probablemente viola SRP. "Maneja reservas y notificaciones" es señal de partir; "Maneja reservas y sus validaciones" probablemente es una sola responsabilidad coherente.
  - SRP refuerza el límite de 150 líneas por archivo (ver sección "Límite de tamaño de archivo" más abajo): cuando un archivo se acerca al límite, casi siempre es porque está empezando a violar SRP.
- **Tipos antes que comentarios**. Si un tipo de TypeScript puede expresar la restricción, no la escribas en un comentario.
- **Fallar rápido y ruidoso**. Errores se propagan hacia arriba; no se tragan con `try { } catch { /* nada */ }`.
- **No optimizar antes de medir**. El cuello de botella casi nunca está donde parece.
- **No metas dependencias sin justificación**. Cada paquete nuevo agrega superficie de ataque, peso al bundle y mantenimiento futuro.

## Límite de tamaño de archivo

**Todo archivo de código fuente está limitado a 150 líneas no vacías y no comentadas.**

### Cómo se cuenta

- Cuenta cada línea con código ejecutable o declarativo.
- **No cuentan**: líneas vacías, comentarios, y la línea del cierre de bloque cuando solo tiene `}` o `)`.
- El conteo aplica al archivo entero, incluyendo imports, tipos, código.
- El linter del proyecto enforza el límite automáticamente; un PR que rompe el límite no pasa CI.

### Por qué existe este límite

- Es un disparador de SRP. Cuando un archivo se acerca al límite, casi siempre es porque está acumulando responsabilidades que deberían vivir en archivos separados.
- Archivos pequeños son navegables sin scroll, comprensibles en una pasada de lectura, y produce diffs más focalizados en PRs.
- En este proyecto un archivo grande es una señal de alarma, no de productividad.

### Cuando un archivo se acerca al límite

A 100 líneas, empezás a pensar dónde se va a partir. A 130, ya estás haciéndolo. No esperés a chocar contra 150 para decidir.

Patrones comunes de partición:

- Una clase o módulo grande → varios módulos cohesivos en una carpeta.
- Un componente React con varios sub-elementos → componentes hijos en archivos hermanos.
- Una función con muchos helpers internos → helpers exportados en un archivo `<feature>.helpers.ts`.
- Un schema Zod gigante → varios schemas más chicos compuestos.

### Excepciones permitidas (lista cerrada)

Estas son las únicas excepciones, y cada una debe documentarse con un comentario al inicio del archivo explicando por qué pasa el límite:

- **Archivos de migración SQL** (`migrations/*.sql`). Un `CREATE TABLE` con muchas columnas puede pasar de 150 líneas legítimamente. Ningún beneficio en partir migraciones.
- **Archivos de diccionarios i18n** (`locales/*.json`). Son datos, no código.
- **Archivos generados automáticamente** (tipos de Supabase generados, etc.). Llevan header `// AUTO-GENERATED — DO NOT EDIT`.
- **Archivos de test que ejercitan un módulo grande con muchos casos**. Pueden pasar el límite si la alternativa es esconder cobertura. Aún así, preferir múltiples archivos de test por aspecto cuando sea natural.

Componentes React, lógica de negocio, server actions, queries, configs, no califican como excepción. Si tu componente "necesita" más de 150 líneas, está mal diseñado.

## Constantes y prohibición de strings mágicos

**Cero strings mágicos. Cero números mágicos. Sin excepciones en código de aplicación.**

Un string o número mágico es un valor literal que aparece directamente en código de negocio y tiene significado semántico. Ejemplos:

```typescript
// MAL
if (booking.status === 'confirmed') { ... }
if (Date.now() - tour.startTime < 24 * 60 * 60 * 1000) { ... }
const fee = total * 0.029 + 30;
await stripe.charges.create({ source: 'tok_visa', ... });
return { error: 'BOOKING_CAPACITY_EXCEEDED' };
```

```typescript
// BIEN
import { BookingStatus } from '@/shared/constants/booking';
import { CANCELLATION_WINDOW_MS } from '@/shared/constants/policies';
import { STRIPE_FEE_PERCENT, STRIPE_FEE_FIXED_CENTS } from '@/shared/constants/payments';
import { ErrorCode } from '@/shared/constants/errors';

if (booking.status === BookingStatus.Confirmed) { ... }
if (Date.now() - tour.startTime < CANCELLATION_WINDOW_MS) { ... }
const fee = total * STRIPE_FEE_PERCENT + STRIPE_FEE_FIXED_CENTS;
return { error: ErrorCode.BookingCapacityExceeded };
```

### Reglas concretas

- **Estados, tipos, kinds, channels**: definidos como `enum` o `as const` en `shared/constants/` o derivados de schemas Zod. Jamás como string literal en código de negocio.
- **Códigos de error**: en `shared/constants/errors.ts`, usados por código en logs, responses y mensajes.
- **Configuración numérica**: tiempos de cancelación, capacidades default, ventanas de retry, valores de fee, límites de paginación, todo en `shared/constants/` o en variables de entorno tipadas.
- **URLs y endpoints**: en `shared/constants/urls.ts` o derivados de variables de entorno.
- **Claves de i18n**: usadas como `t(I18nKey.BookingConfirmed)`, con el enum/objeto definido en `shared/i18n/keys.ts`. Esto previene typos silenciosos en claves.
- **Roles y permisos**: enum o `as const`.
- **Tipos de tickets** (`adult`, `child`, `infant`): enum compartido con Zod y DB.

### Qué SÍ puede ser literal

No es razonable prohibir absolutamente todo. Las siguientes son aceptables:

- **Claves de objetos en estructuras de datos puras** (configuración, mapas).
- **Valores en tests** que explicitan el comportamiento esperado. En tests, el literal acerca el assertion al resultado y es deseable.
- **Strings de presentación dentro del diccionario i18n** (`locales/es.json`). Ahí los strings de UI viven; no se exportan a constantes porque no son identificadores.
- **El número `0`, `1`, `-1`** en contextos donde su significado es evidente (índices, contadores).
- **Selectores CSS dentro de archivos `.module.css`**. Son nombres locales del módulo.

### Organización de constantes

```
shared/constants/
├── booking.ts          # BookingStatus, BookingCancellationReason, etc.
├── notifications.ts    # NotificationKind, NotificationChannel, NotificationStatus.
├── payments.ts         # PaymentStatus, STRIPE_FEE_PERCENT, currencies.
├── policies.ts         # CANCELLATION_WINDOW_MS, MIN_BOOKING_LEAD_TIME_MS, etc.
├── errors.ts           # ErrorCode con todos los códigos del sistema.
├── i18n.ts             # claves de i18n como constantes.
└── urls.ts             # paths internos y de servicios externos.
```

Cada archivo respeta el límite de 150 líneas; si una agrupación crece más, se divide por subdominio.

### Detección automática

El linter del proyecto incluye reglas que detectan:

- Comparaciones contra strings literales en contextos sospechosos (`status === '...'`).
- Números con sufijos de tiempo escritos en línea (`24 * 60 * 60 * 1000`).
- Llamadas a funciones de i18n con claves literales (`t('something')` en lugar de `t(I18nKey.Something)`).

Las reglas tienen exceptions configuradas para los casos permitidos arriba. Si una regla te molesta, primero verificá si tu caso encaja en los casos permitidos antes de pensar en desactivarla.

## Estructura del monorepo (recordatorio)

```
web/      → Next.js App Router (Vercel)
worker/   → Node.js cron (Railway)
shared/   → tipos y schemas Zod compartidos
migrations/ → SQL migrations
docs/     → specs y documentación
```

`web/` y `worker/` importan de `shared/` con paths relativos (`../../shared/types`). No hay workspace tooling activo; lo agregaremos cuando duela.

## Organización dentro de `web/`

```
web/
├── app/
│   ├── (public)/           # rutas públicas (sin auth)
│   │   ├── layout.tsx      # header marketing, footer
│   │   ├── page.tsx        # landing
│   │   └── tours/[slug]/
│   ├── (admin)/            # rutas autenticadas (panel operador)
│   │   ├── layout.tsx      # sidebar, requiere auth
│   │   └── dashboard/
│   ├── (auth)/             # login, magic link, reset
│   └── api/
│       └── webhooks/stripe/
├── lib/
│   ├── db/                 # cliente Supabase, repositories
│   ├── stripe/             # wrappers de Stripe
│   ├── email/              # sender, no templates
│   ├── booking/            # lógica de negocio de reservas
│   ├── auth/               # helpers de autenticación
│   ├── i18n/               # diccionarios y helpers
│   └── utils/              # solo utilidades genuinamente genéricas
├── components/
│   ├── ui/                 # componentes base reutilizables
│   │   ├── Button/
│   │   │   ├── Button.tsx
│   │   │   └── Button.module.css
│   │   └── Input/
│   ├── public/             # componentes del portal público
│   └── admin/              # componentes del panel admin
├── emails/                 # templates React Email (.tsx)
├── locales/                # archivos de traducción
│   ├── es.json
│   └── en.json
└── tests/
```

**Regla de oro de organización**: las cosas que cambian juntas, viven juntas. Si modificás una página del checkout y eso siempre implica modificar su lógica, la lógica vive cerca de la página, no en un `lib/everything/`.

## Estilos

Los estilos viven en **archivos separados por componente o por feature**, nunca en línea dentro de los archivos `.tsx` salvo casos muy puntuales (un estilo dinámico calculado desde props que no puede expresarse de otra forma).

### Regla

Por cada componente o página que tenga estilos propios, existe un archivo `.module.css` (CSS Modules) hermano. El componente lo importa.

```
components/public/BookingCard/
├── BookingCard.tsx
├── BookingCard.module.css
└── BookingCard.test.tsx
```

```tsx
// BookingCard.tsx
import styles from './BookingCard.module.css';

export function BookingCard({ booking }: Props) {
  return (
    <article className={styles.card}>
      <h3 className={styles.title}>{booking.tourName}</h3>
      <p className={styles.meta}>{booking.startTime}</p>
    </article>
  );
}
```

```css
/* BookingCard.module.css */
.card {
  padding: 1rem;
  border-radius: 12px;
  background: var(--color-surface);
}

.title {
  font-size: 1.125rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
}

.meta {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}
```

### Estilos por feature

Cuando varios componentes de la misma feature comparten estilos (variables, mixins, layouts), se crea un archivo `feature.module.css` en la raíz de la carpeta de la feature. Los componentes de esa feature lo importan junto con su propio módulo.

```
app/(public)/checkout/
├── page.tsx
├── checkout.module.css        # estilos compartidos del flujo de checkout
├── PaymentForm/
│   ├── PaymentForm.tsx
│   └── PaymentForm.module.css
└── OrderSummary/
    ├── OrderSummary.tsx
    └── OrderSummary.module.css
```

### Variables globales

Los **design tokens** (colores, espaciados, tipografía, breakpoints, radios, sombras) viven en `web/app/globals.css` como custom properties. Los archivos `.module.css` los consumen con `var(--token)`, jamás hardcodean valores.

```css
/* globals.css */
:root {
  --color-primary: #1d9e75;
  --color-surface: #ffffff;
  --color-text-muted: #6b7280;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --radius-md: 8px;
  --radius-lg: 12px;
}
```

Si necesitás un color o tamaño nuevo, lo agregás al `globals.css` con un nombre semántico. No introducís `#3a8b65` directamente en `BookingCard.module.css`.

### Estilos no permitidos

- **Estilos inline** (`style={{ ... }}`) salvo cuando el valor depende de runtime y no se puede expresar de otra forma (ej: `style={{ width: `${progress}%` }}`). Para todo lo demás, clase CSS.
- **`<style>` tags dentro de componentes**. Rompe SSR consistency y dificulta la organización.
- **CSS-in-JS** (styled-components, emotion). Decisión deliberada: agrega complejidad, runtime cost y tooling. CSS Modules cubre el 100% de nuestras necesidades.
- **Tailwind utility classes en JSX**. Igualmente deliberado. Llenan los componentes de ruido y dispersan los estilos. Si querés algo parecido a utilities, definí clases compartidas en el `.module.css` de feature.
- **Selectores globales en módulos**. Cada `.module.css` solo afecta a su componente. Si necesitás estilo global (reset, tipografía base), va a `globals.css`.

### Justificación

Esta convención tiene tres motivos concretos:

1. **Single Responsibility aplicado a UI**: un componente `.tsx` se ocupa de la lógica y el markup; el `.module.css` se ocupa de la presentación. Cambiar el color de un botón no requiere abrir el archivo de lógica.
2. **Diff-friendly**: cuando un cambio toca solo estilos, el diff es exclusivamente CSS. Más fácil de revisar.
3. **Performance**: CSS Modules se compilan a clases atómicas y se cargan a demanda con Next.js. Sin runtime overhead de CSS-in-JS.

### Excepción para emails

Los templates de email en `web/emails/` no pueden usar CSS Modules (React Email los renderiza a HTML con estilos inline para máxima compatibilidad con clientes de correo). Para emails se usan estilos inline mediante `style={{ ... }}` o el sistema de styling propio de React Email. Esta es la única excepción autorizada.

## TypeScript

- **`strict: true`** en `tsconfig.json`, no se relaja.
- **No `any`**. Si genuinamente no se conoce el tipo (parsing de input externo), usar `unknown` y refinar con type guards o Zod.
- **No `@ts-ignore` ni `@ts-expect-error`** sin un comentario explicando por qué. Idealmente, en ningún caso.
- **Tipos derivados**. Si tenés un schema Zod, derivá el tipo TypeScript con `z.infer<typeof schema>`. No mantengas el tipo y el schema en paralelo.
- **Naming**: `PascalCase` para tipos y componentes, `camelCase` para funciones y variables, `UPPER_SNAKE` para constantes que son verdaderas constantes (no para "valores configurables").
- **Discriminated unions** sobre flags booleanas para estados. `{ status: 'idle' } | { status: 'loading' } | { status: 'success', data: T }` es mejor que `{ loading: bool, error: ..., data: ... }`.

## Validación con Zod

Toda entrada externa pasa por Zod antes de tocar lógica de negocio:

- Formularios del frontend → schema Zod en `shared/schemas.ts`.
- Bodies de API routes → schema Zod, parse antes de hacer nada.
- Webhooks de Stripe → schema Zod específico para cada tipo de evento.
- Variables de entorno → schema Zod cargado al inicio del proceso.

Patrón estándar:

```typescript
// shared/schemas.ts
export const BookingCreateSchema = z.object({
  tour_instance_id: z.string().uuid(),
  customer_email: z.string().email(),
  customer_name: z.string().min(1).max(120),
  tickets: z.array(z.object({
    type: z.enum(['adult', 'child', 'infant']),
    passenger_name: z.string().min(1).max(120).optional(),
  })).min(1).max(20),
});

export type BookingCreate = z.infer<typeof BookingCreateSchema>;
```

## Base de datos

### Migraciones

- Una migración por cambio cohesivo. No mezclés "crear tabla X" con "renombrar columna Y de tabla Z".
- Naming: `<YYYYMMDDHHMM>_<descripción_snake_case>.sql`. Ejemplo: `202605191430_create_bookings_table.sql`.
- Siempre incluyen **up** y **down**. Si una migración no es reversible (drop de columna con datos), documentar explícitamente al inicio del archivo.
- Las migraciones son **append-only**. Una vez mergeada a `main`, no se edita; si tiene problemas, se hace una nueva migración que la corrija.

### Queries

- **No raw SQL embebido en código de aplicación** salvo casos justificados (queries complejas con CTEs). Usar el query builder (Drizzle o Supabase client) o un repository pattern.
- **Repositories en `lib/db/`**. Cada agregado de dominio tiene su archivo: `bookings.ts`, `tours.ts`, `payments.ts`. Exponen funciones tipadas; los callers no construyen queries directamente.
- **Transacciones** para cualquier operación que toque >1 tabla o que requiera consistencia. La función que orquesta la transacción vive en `lib/booking/`, `lib/payments/`, etc., no en el repository.
- **`SELECT ... FOR UPDATE`** se usa para concurrency en `tour_instances.capacity_reserved` y para cualquier contador denormalizado.

### Reglas de modelado

- **Dinero en centavos como entero**, columna `amount_cents int`. Moneda en columna aparte `currency text` (`'USD'` o `'CRC'`). Nunca `decimal` ni `float` para dinero.
- **Timestamps en UTC**. Tipo `timestamptz`. La presentación en zona horaria del usuario es responsabilidad de la capa de UI.
- **IDs UUID v7** (`uuidv7()` en Postgres 17). Si no está disponible, v4 con índice secundario en `created_at`.
- **Soft delete** solo donde tiene sentido (operadores, tours, guides). Reservas y pagos nunca se borran.
- **`jsonb` para campos i18n** con estructura `{"es": "...", "en": "..."}`. Acceso desde código con fallback al idioma base.
- **Row Level Security (RLS)** activado en todas las tablas que tocan datos de operadores. Las políticas viven con la migración que crea la tabla.

## Pagos

El sistema usa **OnvoPay** como pasarela única en MVP, con arquitectura preparada para sumar pasarelas adicionales (PayPal Merchant post-MVP) sin reescribir lógica de negocio.

### Arquitectura: adapter pattern

- **Capa de adaptadores** en `lib/payments/adapters/`. Una implementación por pasarela: `onvopay.ts` ahora, `paypal.ts` después. Todos implementan la misma interfaz `PaymentProvider`.
- **Lógica de negocio en `lib/payments/`** que consume la interfaz, no la implementación concreta. Esto significa que cuando se sume PayPal, **cero código de negocio cambia**.
- **Resolución de pasarela** según contexto: el usuario elige en checkout, o el sistema elige según país/moneda detectado.

### Reglas generales (aplican a cualquier pasarela)

- **Llaves**: nunca commiteadas. Solo en variables de entorno tipadas con Zod.
- **Webhook handler idempotente**: tabla `processed_webhook_events` con `event.id` (o equivalente del proveedor) como PK. Insertar primero, procesar después. Si el insert falla por conflict, devolver 200 sin procesar.
- **Wrappers en `lib/payments/adapters/<provider>.ts`**: nada de SDK del proveedor en componentes ni en server actions directamente. Todas las llamadas pasan por adaptadores que loggean, manejan errores y devuelven tipos limpios.
- **Refunds programados**: no se ejecutan en el handler de cancelación; se encolan como notificación + job. Esto los hace reintentables si la pasarela está caída.
- **Modelo de datos**: la tabla `payments` tiene `external_provider` (`onvopay`, `paypal`) y `external_payment_id`. Generalizada desde el día uno para no migrar al sumar pasarelas.

### Particularidades de OnvoPay

- **Sandbox**: `https://api.dev.onvopay.com` con llaves `onvo_test_*`.
- **Producción**: `https://api.onvopay.com` con llaves `onvo_live_*`.
- **Montos en centavos** (igual que Stripe). Moneda: `CRC` o `USD`.
- **Payment Intents** como recurso primario, similar a Stripe (la API se inspira en ese patrón).
- **Webhooks**: configurables con secreto para verificación HMAC.
- **SINPE Móvil** soportado nativamente como método de pago alternativo a tarjeta. Comisión más baja (1.5%) que tarjeta (3.5%).
- **Sin Platform fee / sin marketplace**: el modelo es merchant estándar. Una sola cuenta recibe los pagos.
- **Documentación oficial**: https://docs.onvopay.com/
- **SDK oficial**: `@onvo/onvo-pay-js` en npm (verificar versión actual al instalar).

### Agregar una nueva pasarela en el futuro

Cuando se sume PayPal u otra pasarela post-MVP, el procedimiento es:

1. Producir spec dedicado para la integración (sigue feature-workflow).
2. Verificar disponibilidad y términos con **external-services-vetting** antes de cualquier código.
3. Crear `lib/payments/adapters/<provider>.ts` implementando la interfaz `PaymentProvider`.
4. Agregar constantes del proveedor a `shared/constants/payments.ts`.
5. Agregar UI de selección en checkout.
6. Tests del adaptador siguiendo testing-practices (idempotencia, webhooks, fallas).

**Sin tocar la lógica de negocio en `lib/booking/` ni `lib/payments/*` fuera de adaptadores.**

## Email

- **Resend para envío**, React Email para templates.
- **Templates en `web/emails/`**, un archivo `.tsx` por template.
- **No mandar emails directamente desde handlers**. Se insertan filas en `notifications` y el worker las procesa. Esto da idempotencia, reintentos y auditabilidad.
- **Cada template recibe props tipadas** con un schema Zod (en `shared/schemas.ts` bajo `EmailPropsSchema`).
- **i18n**: cada template tiene versión ES y EN en el mismo archivo, seleccionada por `props.locale`.
- **Subjects**: claros, en presente, primera persona del receptor cuando aplica. Ej: "Tu reserva está confirmada — Tour Birdwatching Monteverde".

## Internacionalización

- **Idiomas soportados**: `es` (default) y `en`.
- **Diccionarios** en `web/locales/es.json` y `web/locales/en.json`.
- **Estructura plana o anidada poco profunda** (máx 2 niveles). Claves en kebab-case en inglés: `booking.confirmation-sent`, `tour.capacity-full`.
- **Sin interpolación compleja**. Para plurales o reemplazos, usar la convención del paquete elegido (recomendado: `next-intl`). No inventar interpolación custom.
- **No hardcodear strings de UI** en componentes. Toda string que ve un usuario pasa por el diccionario.

## Manejo de errores

- **Errores específicos en `lib/errors.ts`** con clase base `AppError`. Subclases: `ValidationError`, `NotFoundError`, `ConflictError`, `PaymentError`, `ExternalServiceError`.
- **Cada error específico tiene un código** (`error.code`) estable, usable en logs y en respuestas de API. Ejemplo: `BOOKING_CAPACITY_EXCEEDED`, `STRIPE_PAYMENT_FAILED`.
- **No tragarse errores con `catch { }`** salvo casos justificados (logging best-effort). El handler de top level los captura y los formatea.
- **No exponer mensajes internos al cliente**. La respuesta JSON tiene `{ error: { code, message_i18n_key } }`. El frontend traduce el mensaje según el código.
- **Errores de Stripe**: capturarlos en los wrappers, mapearlos a `PaymentError` con código claro, preservar el ID original en el body para debugging.

## Logging

- **Structured logging** con un logger central (recomendado: `pino` en worker, helper propio en web).
- **Niveles**: `debug`, `info`, `warn`, `error`. En producción se loggea `info+`.
- **Cada log incluye context**: `bookingId`, `operatorId`, `requestId`, etc. Sin context, un log es ruido.
- **No loggear PII innecesaria**. Email completo: solo si es relevante. Datos de tarjeta: nunca.
- **Logs en español están permitidos** si son para humanos del equipo, pero claves de error y códigos son siempre en inglés.

## Tests

Las prácticas detalladas de testing viven en su propia skill: **testing-practices**. Lo mínimo que debe saberse al escribir cualquier código en este proyecto:

- Toda lógica de negocio se prueba antes de mergear.
- El stack es **Vitest** (unit + integration) y **Playwright** (e2e cuando aplique).
- Tests viven junto al código que prueban (`foo.ts` + `foo.test.ts`) para unit; en `tests/integration/` para tests que tocan DB.
- Mocks de DB **no se usan**: los tests de integración corren contra una instancia real de Postgres.
- El nivel de cobertura, los patrones (AAA, fixtures, factories), las prohibiciones (mocks excesivos, tests frágiles, asserts inespecíficos) y las reglas de naming están en **testing-practices**. Esa skill se carga automáticamente cuando se escribe o revisa código de tests.

## Worker (background jobs)

- **Cada job es un archivo en `worker/jobs/`** con una función exportada que el orquestador llama.
- **Idempotencia obligatoria**: si un job se ejecuta dos veces sobre el mismo dato, el resultado debe ser el mismo. Lo logra usando estados en DB (`pending → sent`) y verificando estado antes de actuar.
- **Sin estado en memoria**. Todo lo que un job necesita saber, lo lee de DB. Esto permite reiniciar el worker sin perder nada.
- **Reintentos con backoff exponencial**: 1min, 5min, 30min. Después de 3 fallos, marcar como `failed` y loggear.

## Server Actions y API routes

- **Server Actions** para mutaciones desde formularios del propio Next.js (preferido).
- **API routes** para webhooks externos (Stripe) y para casos donde el cliente realmente necesita un endpoint REST.
- Ambos validan inputs con Zod, llaman a lógica de negocio en `lib/`, y devuelven errores estructurados.
- **No lógica de negocio dentro del handler**. El handler valida, llama a `lib/`, formatea respuesta.

## Variables de entorno

- **Cargadas y validadas al inicio** con un schema Zod en `web/lib/env.ts` y `worker/env.ts`. Si falta una, el proceso muere al arrancar; no en runtime cuando se necesita.
- **`.env.example` siempre al día**. Cada variable nueva se documenta ahí con un comentario breve.
- **Distinguir `NEXT_PUBLIC_*`**: solo lo que es realmente público (URL pública de Supabase, anon key). El resto, sin prefijo.
- **Service role keys** (Supabase, Stripe secret) jamás se exponen al cliente. Solo se usan en server actions, API routes y worker.

## Naming general

- **Archivos**: `kebab-case.ts` para módulos, `PascalCase.tsx` para componentes React.
- **Componentes**: `PascalCase`. Un componente por archivo. Nombre del archivo = nombre del componente.
- **Carpetas**: `kebab-case`. Excepción: route groups de Next.js usan `(paréntesis)` por convención del framework.

## Comentarios

- **Comentarios explican el por qué, no el qué**. Si necesitás un comentario para explicar qué hace el código, generalmente el código necesita refactor.
- **TODO comments** llevan dueño y contexto: `// TODO(santi): refactorizar cuando tengamos más de un operador grande, ver spec 0023`. Sin dueño y sin referencia se vuelven basura.
- **Comentarios desactualizados son peor que ningún comentario**. Si tocás código, revisá los comentarios cercanos.

## Performance

- **No optimices antes de medir**. Si una página tarda 200ms y eso es aceptable, no la rompas para hacerla 50ms.
- **N+1 queries son el enemigo recurrente**. Cuando cargues una lista y necesités datos relacionados, hacelo en una sola query con joins o usando `IN`.
- **Caching**: solo donde haya métrica que muestre necesidad. Y siempre con invalidación clara.
- **Imágenes**: usar `next/image`. Storage en Supabase, optimización vía Next.

## Seguridad

- **Inputs externos siempre validados** con Zod antes de tocar DB.
- **Queries parametrizadas siempre**. Nunca string concatenation para SQL.
- **Tokens de magic link como hash en DB** (SHA-256 o bcrypt). Plano solo en el email.
- **Rate limiting** en endpoints sensibles (crear reserva, validar magic link). Usar Upstash o middleware propio.
- **CORS estricto** para API routes que no son públicas.
- **Headers de seguridad** vía `next.config.js` (CSP, HSTS, X-Frame-Options).

## Tooling

- **ESLint + Prettier**: configuración en raíz, no se relaja.
- **Husky + lint-staged**: hooks de pre-commit que corren lint y typecheck sobre los archivos modificados.
- **CI**: en cada PR corre `pnpm lint && pnpm typecheck && pnpm test`. Sin verde, no se mergea.

## Anti-patrones específicos del proyecto

- **Modificar `bookings.status` directamente** en cualquier lado del código. Las transiciones de estado pasan por funciones en `lib/booking/state.ts` que validan, registran en `audit_logs`, y disparan notificaciones.
- **Enviar emails sin pasar por la cola** (`notifications`). Pierde idempotencia y trazabilidad.
- **Capacity reserved actualizado fuera de transacción** con `FOR UPDATE`. Garantiza race condition.
- **Strings de UI hardcodeados**. Rompe i18n.
- **Tipos derivados que duplican los schemas Zod**. Usar `z.infer`.
- **Lógica de negocio en componentes React**. Va a `lib/`.
- **Funciones o componentes "kitchen sink"** que hacen varias cosas no relacionadas. Aplicar Single Responsibility y partir.
- **Estilos hardcodeados con valores literales** (`color: #1d9e75`). Usar variables de `globals.css`.
- **Estilos inline o Tailwind utilities en JSX**. Usar `.module.css` hermano del componente.
- **Archivos que sobrepasan 150 líneas** sin estar en la lista de excepciones permitidas. Indica acumulación de responsabilidades.
- **String literals para estados, kinds, tipos, códigos de error, claves i18n** en código de negocio. Usar constantes desde `shared/constants/`.
- **Números literales con significado semántico** (ventanas de tiempo, fees, capacidades). Constantes nombradas.

## Skills relacionadas

- **feature-workflow** — el ciclo completo de implementación de una feature.
- **spec-authoring** — los specs definen el "qué"; esta skill define el "cómo" del código.
- **commit-and-pr** — para empaquetar y enviar el código que esta skill define.
