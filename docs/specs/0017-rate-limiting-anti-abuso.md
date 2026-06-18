# 0017 — Rate limiting y protección anti-abuso

- **Estado**: approved
- **Autor**: Kenneth
- **Creado**: 2026-06-10
- **Última actualización**: 2026-06-11 (implementado, verificado por pentest + Playwright, y mergeado; ver changelog)
- **Rama**: feat/0017-rate-limiting-anti-abuso
- **PR**: #34 (mergeado a `dev` el 2026-06-11, merge `4831abb`)

> Corrige el hallazgo **M-3** de la auditoría de seguridad del 2026-06-10: el sistema
> no tiene **ningún** rate limiting a nivel de aplicación. Se separa de los otros
> hallazgos (specs 0015 y 0016) porque requiere una **decisión de infraestructura**
> (dónde se guarda el estado del contador) que dispara el procedimiento de
> **vetting de servicios externos** del proyecto (sección 5.2 + skill
> `external-services-vetting`). No mergear sin resolver esa decisión.

> **Nivel de detalle**: como 0015/0016, este spec es detallado a propósito (pedido de
> la auditoría). La sección 5 incluye qué releer para recuperar el contexto.

## 1. Contexto y motivación

La auditoría confirmó (grep incluido) que no hay rate limiting en ninguna parte de la
app: ni en el login, ni en forgot-password, ni en el checkout, ni en la validación de
tokens. Las únicas defensas existentes son indirectas: la entropía de los tokens (que
hace inviable adivinarlos por fuerza bruta) y los límites internos de Supabase GoTrue
(laxos por defecto y fuera de nuestro control fino).

Sin rate limiting, quedan abiertos varios abusos:

- **Fuerza bruta de contraseñas** en el login (`signInWithPassword`): un atacante prueba
  miles de contraseñas contra una cuenta de admin/staff.
- **Abuso de forgot-password**: disparar cientos de emails de recuperación a una víctima
  (email bombing) o sondear el sistema.
- **DoS de inventario en el checkout**: cada checkout crea un hold que reserva cupo por
  15 minutos. Un atacante automatiza checkouts y **agota el cupo de todas las salidas**,
  bloqueando reservas reales, sin pagar nada. Además genera payment intents en OnvoPay
  (abuso de su API / posibles costos).
- **Sondeo de tokens** de reserva/guía: mitigado por la entropía (256 bits), pero sin
  techo de intentos.

Afecta al **operador** (cuentas comprometidas, inventario bloqueado, costos de pasarela)
y a los **turistas** (no pueden reservar si el cupo está secuestrado). Es un bloqueante
de producción: una app con dinero expuesta a internet necesita throttling.

## 2. Objetivos

- Limitar la tasa de intentos en los puntos sensibles: login, forgot-password y
  checkout (creación de reserva/hold), por identidad relevante (IP y/o email/cuenta).
- Devolver una respuesta clara y segura al exceder el límite (sin filtrar si la cuenta
  existe), y registrar el evento para observabilidad.
- Elegir un mecanismo de almacenamiento del contador que funcione en el entorno
  serverless de Vercel (estado compartido entre instancias) **sin** introducir un
  servicio externo no vetado.
- Dejar los límites configurables (por env o constante) para poder afinarlos sin
  redeploy de lógica.

## 3. Fuera de alcance

- **Protección DDoS a nivel de red / capa 3-4**: es responsabilidad de la
  infraestructura (Vercel / un CDN/WAF por delante), no de este spec.
- **CAPTCHA / challenge interactivo**: posible mejora futura (p. ej. en login tras N
  fallos), pero fuera de alcance acá; se menciona como evolución.
- **Bloqueo/lockout persistente de cuentas** tras N fallos (con desbloqueo por email):
  fuera de alcance; este spec hace throttling temporal, no lockout.
- No se cambia el flujo funcional de login, forgot-password ni checkout; solo se les
  antepone el control de tasa.
- No se implementa rate limiting en el webhook de OnvoPay (está protegido por secreto e
  idempotencia; un límite ahí podría descartar reintentos legítimos de la pasarela). Si
  acaso, se evalúa un límite muy holgado; ver Preguntas abiertas.

## 4. Historias de usuario

> Como operador, quiero que los puntos sensibles de mi app (login, recuperación de
> contraseña, checkout) resistan intentos automatizados y abuso, para que nadie pueda
> forzar contraseñas, bombardear emails ni secuestrar el cupo de mis salidas.

Criterios de aceptación:

- [ ] Tras N intentos fallidos de login desde una misma IP (y/o sobre un mismo email) en
      una ventana de tiempo, los intentos siguientes se rechazan con un error genérico
      hasta que pase la ventana, sin revelar si la cuenta existe.
- [ ] forgot-password se limita por IP y por email destino (no se pueden disparar más de
      N emails a la misma dirección en la ventana).
- [ ] El checkout (creación de reserva/hold) se limita por IP, de modo que un cliente no
      pueda crear más de N reservas/holds en la ventana; al exceder, error genérico sin
      crear hold/booking/payment.
- [ ] El estado del rate limit es compartido entre instancias serverless (no por
      proceso): el límite se respeta aunque las requests caigan en lambdas distintas.
- [ ] Exceder un límite se registra (log/Sentry) con la clave (sin PII innecesaria) para
      poder observar abuso.
- [ ] Los límites y ventanas son configurables sin cambiar lógica.

## 5. Diseño técnico

### 5.0 Lectura obligatoria antes de tocar código (recuperá el contexto vos mismo)

Estado documentado al **2026-06-10**; verificá contra el código vivo:

1. `web/app/[locale]/(auth)/login/actions.ts` — `signIn` llama
   `signInWithPassword`. Acá va el límite por IP+email.
2. El componente de forgot-password (`web/app/[locale]/(auth)/forgot-password/ForgotPasswordForm.tsx`)
   llama `resetPasswordForEmail` **desde el cliente browser** (por PKCE; ver memoria
   `tech-decisions`). Esto es importante: el límite NO puede ir solo en un Server Action,
   porque la llamada sale del browser. Hay que decidir dónde interceptar (ver 5.3).
3. `web/lib/booking/checkout-action.ts` + `web/lib/booking/create.ts` (`initCheckout`,
   `createHold`) — el checkout que crea holds/bookings/payments. Coordinar con el spec
   0015 (que reescribe este mismo Server Action).
4. `web/middleware.ts` — corre en cada request, ya tiene acceso a headers (IP via
   `x-forwarded-for`) y a Supabase. Candidato para aplicar límites por ruta, pero ojo
   con la latencia (la auditoría de performance del 2026-06-10 ya notó que el middleware
   hace `getUser()` en cada request; no recargarlo de más).
5. `web/lib/db/supabase-service.ts` — si el store es Postgres, el limiter usará una
   función DB vía service client (o el cliente que corresponda).
6. Memoria del proyecto: `tech-decisions` (servicios externos validados; Vercel/Supabase
   ya vetados), `workflow-rules` (regla: vetar todo servicio externo nuevo),
   `pre-production-checklist`. La skill `external-services-vetting` es obligatoria si se
   elige un store que implique un proveedor nuevo (ver 5.2).

### 5.1 Mecanismo del limiter (lógica)

Un helper reutilizable en `web/lib/security/rate-limit.ts` (módulo nuevo) expone algo
como `checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; retryAfter?: number }>`.
Implementa **ventana fija** (simple y suficiente) o **sliding window** (más justo) —
decisión en Preguntas abiertas; arrancar con ventana fija.

- La `key` identifica el sujeto + acción: p. ej. `login:ip:<ip>`, `login:email:<emailHash>`,
  `forgot:email:<emailHash>`, `checkout:ip:<ip>`. Hashear el email/identidad en la key
  para no guardar PII en claro en el store.
- Al exceder, devolver `ok:false` y un `retryAfter` (segundos hasta el reset).
- El caller decide la respuesta: el login redirige con error genérico (mismo que
  credenciales inválidas, para no distinguir throttle de cuenta inexistente);
  forgot-password responde como siempre (no revela nada); el checkout devuelve error
  genérico.

### 5.2 Store del contador — DECISIÓN DE INFRAESTRUCTURA (requiere vetting)

El estado debe ser **compartido entre instancias serverless** (Vercel escala a múltiples
lambdas; un contador en memoria por proceso no sirve). Opciones, con el procedimiento de
vetting del proyecto aplicado:

**Opción A (recomendada) — Postgres (Supabase, ya vetado).** Una tabla
`rate_limits(key text primary key, window_start timestamptz, count int)` y una función
`SECURITY DEFINER` `check_rate_limit(p_key text, p_limit int, p_window_seconds int) returns boolean`
que hace el upsert atómico (resetea la ventana si venció, incrementa, devuelve si está
dentro del límite). **Mecanismo de serialización (obligatorio, no "upsert atómico" a
secas):** la lógica de "resetear ventana si venció vs incrementar" tiene una carrera real
(dos transacciones que ven la ventana vencida y ambas resetean a count=1). Resolverla con
**una sola sentencia** `INSERT INTO rate_limits (...) VALUES (..., 1) ON CONFLICT (key) DO
UPDATE SET count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => p_window_seconds) THEN 1 ELSE rate_limits.count + 1 END, window_start = CASE WHEN rate_limits.window_start < ... THEN now() ELSE rate_limits.window_start END`
(el `ON CONFLICT DO UPDATE` toma el row lock, así que el reset/incremento es atómico), o
con `SELECT ... FOR UPDATE` + update. El proyecto ya tiene la lección de concurrencia
documentada (motor de holds, `create_hold_atomic` con `FOR UPDATE`); seguir ese rigor.
Ventajas: **no agrega ningún proveedor nuevo** (Supabase ya está en
la arquitectura y vetado para CR), atómico, transaccional. Desventajas: cada chequeo es
un round-trip a Postgres (aceptable en endpoints sensibles de baja frecuencia como login
y checkout; NO ponerlo en el camino de toda request). Limpieza: un job del worker (o un
`DELETE` oportunista en la función) purga filas con ventana vencida para no inflar la
tabla.

**Opción B — Redis administrado (Upstash / Vercel KV).** Es el estándar de la industria
para rate limiting (TTL nativo, muy rápido). **PERO introduce un proveedor nuevo**, así
que **antes de elegirlo hay que correr la skill `external-services-vetting`** y
documentar la decisión (igual que se hizo con OnvoPay/Resend). Notas de vetting
preliminares (a confirmar con la skill, NO tomar como veredicto):

- Disponibilidad: Upstash/Vercel KV operan globalmente, sin restricción de Costa Rica
  conocida; no requieren entidad legal local (a diferencia de las pasarelas de pago).
- Datos que procesaría: IPs y hashes de identidad (no tarjetas, no PII sensible), con TTL
  corto. Implicación de privacidad menor pero existente (un procesador de datos más).
- Costo: planes gratuitos suelen alcanzar para el volumen de un MVP; confirmar límites.
- Dependencia oculta: Vercel KV hoy es Upstash por debajo (marketplace); contar como un
  procesador, no dos.
  Si se elige B, el helper de 5.1 se implementa contra el cliente de Upstash (p. ej.
  `@upstash/ratelimit`) en vez de Postgres; la interfaz `checkRateLimit` no cambia.

**Bloqueante (regla inviolable del proyecto):** las "notas de vetting preliminares" de
arriba **NO son vetting** y no deben tratarse como tal. Si se elige la Opción B, correr
la skill `external-services-vetting` **completa** y documentar la decisión en la memoria
del proyecto (`tech-decisions` / sección de servicios externos validados) es
**prerequisito de merge**, igual que con OnvoPay y Resend. Sin ese documento, la Opción B
no se implementa. Ver criterio en la sección 11 (Plan de rollout).

**Opción C (complementaria, no sustituye) — Vercel Firewall / WAF rate rules.** Vercel
(ya vetado como hosting) permite reglas de rate limiting a nivel de borde por ruta/IP
desde su dashboard, sin proveedor nuevo. Cubre bien la capa IP (DoS volumétrico) pero no
los límites por identidad (p. ej. por email en login/forgot). Se puede usar **además** de
A/B para una primera barrera en el borde. Configuración fuera del repo (dashboard);
documentar las reglas en el PR/checklist.

**Recomendación del autor**: Opción A (Postgres) para los límites por identidad/acción
(no agrega vendor, cierra el hallazgo), y opcionalmente Opción C en el borde para la
capa IP. Reservar la Opción B para si el volumen real hace que Postgres sea un cuello de
botella, corriendo el vetting formal en ese momento. Decisión final en Preguntas
abiertas.

### 5.3 Dónde se aplica cada límite

- **Login** (`signIn`, Server Action): al inicio del action, antes de
  `signInWithPassword`. Clave doble: por IP y por email (hash). Al exceder cualquiera de
  las dos, redirigir con el **mismo** error genérico de credenciales inválidas (no
  distinguir throttle de credenciales malas, para no dar señal). Resetear/contar fallos:
  contar **intentos** (o solo los fallidos — decisión; contar todos es más simple y
  seguro). Para la IP, ver "Extracción de IP" abajo.

**Extracción de IP (regla fija, no dejar a criterio del implementador):** no existe hoy
ningún helper de IP en `web/` (grep vacío). Crear uno en `web/lib/security/` que: lea el
header `x-forwarded-for`; si tiene varios valores separados por coma, tomar el **primer**
elemento (en Vercel el primero es la IP real del cliente; Vercel reescribe este header,
así que no es spoofeable por el cliente cuando se corre detrás de Vercel); hacer `trim`.
Fallback si el header está ausente (p. ej. local sin proxy): usar una constante
`'unknown'` o la IP de `request` si está disponible — en ese caso el límite por IP queda
laxo en local, lo cual es aceptable (el límite por email/identidad sigue aplicando).
**No** confiar en headers arbitrarios del cliente fuera de la cadena que pone la
plataforma. Documentar este comportamiento por entorno (Vercel vs local) en el código.

- **forgot-password**: la llamada `resetPasswordForEmail` se hace **desde el browser**
  (PKCE; no mover esa llamada a un Server Action — ver memoria `tech-decisions`, rompe el
  flujo). Opciones para interceptar: (a) anteponer un **route handler propio**
  (`POST /api/rate/forgot` o similar) que el form llame ANTES del PKCE; si pasa el
  límite, el browser dispara `resetPasswordForEmail`; si no, devuelve 429 y el form no
  llama a Supabase; (b) límite por IP en `middleware.ts` para la ruta de
  forgot-password; (c) reforzar solo por IP en el borde (Vercel Firewall, Opción C) y
  confiar en el límite propio de GoTrue para el resto. **Recomendación por defecto: (a)**
  — es la única que da control por **email** (hash) además de por IP sin tocar el flujo
  PKCE; (b) solo da control por IP. Confirmar en Preguntas abiertas, pero el cuerpo del
  spec asume (a).
- **Checkout** (`checkoutAction` / `initCheckout`): límite por IP antes de crear el hold.
  Coordinar con 0015 (mismo Server Action). Complementa el tope de cantidades de 0015
  (que acota una sola request) limitando la **frecuencia** de requests.
- **Tokens de reserva/guía**: límite holgado por IP en la validación (defensa adicional;
  la entropía ya protege). Opcional; baja prioridad.

### 5.4 Respuesta al exceder

- HTTP 429 donde aplique un route handler; en Server Actions con `redirect`, usar el
  error genérico existente (login) o uno nuevo neutro. Nunca revelar "estás siendo
  limitado por intentos sobre la cuenta X".
- Incluir `Retry-After` cuando sea un route handler.
- Registrar en Sentry/log (warning, agrupado por tipo de límite) la clave y el conteo,
  para observar campañas de abuso. No loguear el email en claro (usar el hash o
  truncado).

## 6. Modelo de datos

- **Opción A (Postgres)**: tabla nueva `public.rate_limits` (`key text PK`,
  `window_start timestamptz`, `count int`) + función
  `public.check_rate_limit(text, int, int) returns boolean` `SECURITY DEFINER` +
  `SET search_path=''` + `REVOKE EXECUTE FROM PUBLIC` (la llama el service client o el
  rol que corresponda). RLS habilitada sin políticas para anon/authenticated (solo
  service_role / la función). Migración:
  `supabase/migrations/<timestamp>_rate_limits.sql`. Pasa por `db-schema-guardian`.
- **Opción B (Redis)**: sin cambios al schema de Postgres; el estado vive en Redis.
- Limpieza (Opción A): `DELETE FROM rate_limits WHERE window_start < now() - interval`
  oportunista en la función o un job del worker; documentar cuál.

## 7. Estados y transiciones

No aplica (no es una máquina de estados de negocio; es un contador con ventana).

## 8. Casos borde y errores

- **IP compartida (NAT corporativo, CGNAT móvil)**: varias personas detrás de una IP
  pueden gatillar el límite por IP entre sí (falso positivo). Por eso el login también
  limita por email (la cuenta objetivo), y los límites por IP deben ser holgados. Elegir
  ventanas/umbrales que no molesten a usuarios legítimos.
- **Ataque distribuido (muchas IPs)**: el límite por IP no alcanza; por eso el login
  limita además por email (acota intentos contra una cuenta sin importar la IP).
- **Spoofing de `x-forwarded-for`**: confiar solo en el valor que inyecta la plataforma
  (Vercel); no confiar en headers arbitrarios del cliente. Documentar cómo se extrae la
  IP real en el entorno de deploy.
- **El store no responde** (store caído): es distinto del caso "límite excedido" del
  criterio de aceptación de la sección 4 (ese asume el store operativo). Recomendación
  **fail-open con logging** en todos los endpoints: si el chequeo del límite falla por
  un error del store, dejar pasar la request y registrar el fallo (Sentry), en vez de
  bloquear usuarios legítimos. Justificación: con la Opción A el store ES Postgres (la
  DB principal); si Postgres está caído, el checkout/login ya no funcionan por otras
  razones, así que fail-closed solo agregaría un modo de falla sin beneficio. Con la
  Opción B (Redis aparte), fail-open evita que una caída de Redis tumbe el login/checkout.
  Confirmar en Preguntas abiertas, pero el cuerpo del spec asume fail-open + alerta.
- **Reloj/ventana**: usar `now()` del store (Postgres) para evitar skew entre lambdas.
- **Reintentos legítimos de OnvoPay** al webhook: por eso el webhook queda fuera (o con
  límite muy holgado) — no descartar reintentos de la pasarela.
- **Crecimiento de la tabla (Opción A)**: sin limpieza, `rate_limits` crece; la purga
  oportunista/job lo evita.

## 9. Impacto en otras áreas

- **Login / forgot-password (0002/0010)**: ganan throttling; reprobar el flujo legítimo
  para confirmar que umbrales razonables no molestan.
- **Checkout (0006/0015)**: gana throttling; coordinar con 0015 (mismo Server Action).
- **Middleware**: si se aplica algún límite ahí, cuidar la latencia (ver auditoría de
  performance 2026-06-10).
- **Worker**: si se elige la limpieza por job, se suma un job chico al worker.
- **Infra/deploy**: si se usa Opción B, nueva variable de entorno (URL/token de Redis) en
  Vercel + entrada en el pre-production-checklist; si Opción C, reglas en el dashboard de
  Vercel. Si Opción A, nada de infra nueva.
- **Observabilidad**: nuevas alertas/eventos de "rate limit excedido".
- **i18n**: si se agrega un mensaje propio de "demasiados intentos", textos ES/EN; si se
  reusa el genérico, sin cambios.

## 10. Plan de tests

- **Unit**: el helper `checkRateLimit` — dentro del límite devuelve ok; al exceder
  devuelve no-ok con `retryAfter`; resetea al vencer la ventana. Con el store mockeado.
- **Integración (Opción A)** contra DB real: la función `check_rate_limit` cuenta y
  resetea correctamente bajo llamadas concurrentes (probar atomicidad: N llamadas
  paralelas no deben pasar el límite). Reusar el patrón de tests de concurrencia del
  proyecto (`availability.concurrency.test.ts`).
- **Integración login**: N+1 intentos fallidos seguidos → el N+1 se rechaza con error
  genérico; tras la ventana, vuelve a permitir.
- **Integración checkout**: N+1 checkouts desde la misma IP → el N+1 no crea
  hold/booking/payment.
- **Caso borde obligatorio**: fail-open/closed cuando el store falla (simular error del
  store y verificar el comportamiento elegido).
- **Manual (PR)**: ráfaga de logins/forgot/checkout y verificar el bloqueo + el log/alerta.

## 11. Plan de rollout

- **Decisión de store (5.2) resuelta antes de implementar. Es el bloqueante principal.**
  Si la decisión es la Opción B (Redis/Upstash/Vercel KV), el merge está **bloqueado**
  hasta que exista el documento de `external-services-vetting` completo en la memoria del
  proyecto. La Opción A (Postgres) y la C (Vercel Firewall) no agregan proveedor y no
  disparan ese bloqueo.
- **Feature flag**: opcional pero recomendado un kill-switch por env (`RATE_LIMIT_ENABLED`)
  para poder desactivar rápido si un umbral mal calibrado bloquea usuarios legítimos en
  producción.
- **Migración de datos**: ninguna (Opción A solo crea tabla/función).
- **Reversible**: sí (revertir commit + migración; o kill-switch).
- **Afinado**: empezar con umbrales conservadores (holgados) y ajustar observando el log
  de "excedidos". Documentar los valores iniciales en el PR.
- **Comunicación**: ninguna al operador, salvo que se elija Opción B (nueva variable de
  entorno que cargar en Vercel) → entra al pre-production-checklist.

## 12. Métricas de éxito

- Una ráfaga automatizada de logins fallidos contra una cuenta se bloquea tras N
  intentos (verificable en test e e2e manual).
- 0 holds/bookings creados por encima del límite de checkout por IP en la ventana.
- El log/Sentry muestra eventos de "rate limit excedido" cuando se abusa (observabilidad
  funcionando), y 0 reportes de usuarios legítimos bloqueados con los umbrales elegidos.

## 13. Preguntas abiertas — RESUELTAS (2026-06-11)

Decisiones tomadas en la aprobación. Criterio rector: cerrar el hallazgo M-3 **sin
introducir ningún proveedor externo nuevo** (regla inviolable del proyecto: todo vendor
nuevo dispara `external-services-vetting` y bloquea el merge), tomando en todos los casos
la opción recomendada del propio spec. Es el mismo criterio que cerró C-1 (0015): la
opción más segura y menos propensa a otros problemas.

- [x] **Store definitivo** → **Opción A (Postgres, sin vendor nuevo)**. Se descarta la
      Opción B (Redis/Upstash) para el MVP: agregaría un procesador de datos más y
      dispararía el vetting formal (bloqueante de merge), sin beneficio real al volumen
      actual. La **Opción C (Vercel Firewall)** queda como capa de borde **complementaria
      y opcional**, a configurar en el dashboard al hacer el cutover (fuera de este PR;
      se anota en el pre-production-checklist), no en código. Si el volumen real hiciera
      de Postgres un cuello de botella, se reabre la Opción B corriendo el vetting en ese
      momento.
- [x] **Umbrales y ventanas** → se adoptan los valores propuestos como **iniciales y
      conservadores**, en constantes aisladas de la lógica (`shared/constants/rate-limit.ts`):
      login **5 / 15 min por email** y **20 / 15 min por IP**; forgot **3 / hora por email**
      y **10 / hora por IP**; checkout **10 / 10 min por IP**. Se afinan observando los
      eventos de "excedido" en Sentry. Kill-switch por env `RATE_LIMIT_ENABLED` para
      desactivar rápido si un umbral mal calibrado molestara en prod.
- [x] **forgot-password** → **Opción (a)**: route handler propio
      (`POST /api/rate-limit/forgot-password`) que el form llama ANTES del PKCE. Es la
      única que da control por **email** (hash) además de por IP sin mover
      `resetPasswordForEmail` fuera del browser (lo exige PKCE). En 429 el form muestra la
      **misma** respuesta neutra que en el caso exitoso (anti-enumeración: no revela si se
      envió ni si se throttleó).
- [x] **Ante caída del store** → **fail-open + alerta** en todos los endpoints (sección 8).
      Con la Opción A el store ES Postgres (la DB principal); si está caído, login/checkout
      ya no funcionan por otras razones, así que fail-closed sólo agregaría un modo de
      falla. El fallo del store se registra en Sentry (nivel error, agrupado).
- [x] **Webhook de OnvoPay** → **sin límite** (queda fuera de alcance, sección 3). Está
      protegido por secreto + idempotencia; un límite podría descartar reintentos legítimos
      de la pasarela. Si en el futuro hiciera falta, se evalúa un límite muy holgado por IP.
