# 0048 — Topes anti-acaparamiento y captcha del checkout

- **Estado**: approved
- **Autor**: Kenneth (con Claude Code)
- **Creado**: 2026-10-19
- **Última actualización**: 2026-10-20
- **Rama**: feat/0048-topes-y-captcha
- **PR**: (pendiente)

## 1. Contexto y motivación

La re-auditoría de seguridad del 2026-10-18 (`docs/security-audits/2026-10-18-reauditoria-2.md`, PAYSEC-N1 e INFRA-05) encontró que el checkout con cobro diferido (spec 0029/0033) permite **acaparar cupos sin pagar**:

- Una reserva diferida queda viva (`pending_minimum`, y `pending_payment` durante el ciclo de cobro) y su apartado en `paying`. Ese apartado ocupa cupo sin vencimiento hasta que se cobra la salida: semanas o meses.
- Para crearla basta una tarjeta que exista, porque OnvoPay verifica la tarjeta, no los fondos.
- Con una sola IP se llega a unos 100 cupos cada 10 minutos: 10 reservas de hasta 10 personas, que es el límite actual por IP. Alcanza con emails inventados y la misma tarjeta física tokenizada de nuevo, porque cada tokenización da un `payment_method_id` distinto y `bookings_one_live_per_payment_method` no la frena.

Consecuencias:

- Los turistas reales ven la salida llena y no pueden reservar.
- Las reservas falsas cuentan como vendidas contra el mínimo (`departure_seat_counts`). Una salida puede parecer que llegó al mínimo, y cuando la autorización falla, quedar bajo el mínimo. Con la política `staff_decides` (spec 0045, la vigente) decide el staff. Con `auto_cancel`, la salida se puede cancelar con turistas reales adentro.
- Cada reserva encola un correo `booking_reserved` a cualquier dirección, desde el dominio de Boka.

El cobro diferido no se puede apagar (decisión del operador del 2026-10-19), así que hay que cerrar el vector con el flag encendido. Con el flag encendido el checkout inmediato no se ofrece (`checkout-action.ts` devuelve error), así que **todas las reservas pasan por el diferido**.

Beneficiarios: el turista legítimo, que encuentra cupo, y el operador, que no pierde salidas por reservas falsas.

El captcha del login y la recuperación del panel (INFRA-01) no entra acá: va con MFA en un spec propio (§3).

## 2. Objetivos

- Limitar los cupos que una misma persona (mismo email o misma tarjeta física) tiene retenidos en reservas diferidas sin cobrar, sumando todas las salidas.
- Frenar el abuso automatizado del checkout con un captcha en el formulario que crea el apartado.
- Avisar al staff cuando los cupos de una salida se concentran en muy pocas personas sin cobrar, para que revise antes del cobro.
- Cerrar los dos huecos de rate limit del diferido: el paso 2 no tiene límite, y el paso 1 no tiene techo diario por IP.

## 3. Fuera de alcance

- No se cambia el flujo de dinero: cobro diferido, autorización, captura, mínimo y reembolsos quedan igual.
- No se agrega verificación de fondos ni retención al reservar.
- No se identifica a la persona más allá de email y tarjeta: nada de teléfono, documento ni huella del dispositivo.
- No se bloquean ni se tocan las reservas existentes al desplegar: el tope rige para las nuevas y para los cambios de tarjeta.
- No hay captcha en la página de la reserva por token, en la del 3DS ni en el formulario de tarjeta (paso 2).
- **Captcha del login y la recuperación del panel, y MFA para admin y staff**: van en un spec aparte (INFRA-01). Tienen otro rollout (toggle de Supabase Auth, `remoteip` del server action, a qué proyecto apuntan las previews) y no deben frenar este.
- Normalizar alias de email (`+etiqueta`, puntos de Gmail). El tope real contra un atacante es el de tarjeta (§8).

## 4. Historias de usuario

> Como turista, quiero encontrar cupo en la salida que elijo, para que no me lo quiten reservas falsas.

- [ ] Una persona no puede tener más de **10 cupos** en reservas diferidas vivas sin cobrar, sumando todas las salidas futuras. Como una reserva admite hasta 10 personas, una reserva llena el tope: para apartar otra fecha hay que esperar el cobro o cancelar (decisión del operador, 2026-10-20).
  - Una reserva viva es la que está en `pending_minimum`, o en `pending_payment` con tarjeta guardada.
  - La identidad se toma de dos formas por separado: por email y por tarjeta (últimos 4 + marca). Alcanza con que una de las dos llegue al tope.
- [ ] Si una reserva nueva supera el tope, el paso 2 no la crea y muestra: "Ya tenés el máximo de cupos apartados sin cobrar. Esperá el cobro de tus reservas o cancelá alguna para apartar más."
- [ ] En ese caso el apartado queda liberado y el cupo vuelve a estar disponible enseguida.
- [ ] Si con el email y la cantidad pedida ya se supera el tope, el paso 1 lo rechaza con el mismo mensaje, antes de apartar y de crear el customer en OnvoPay.
- [ ] Cambiar la tarjeta de una reserva (página `/booking/[token]/card`) también respeta el tope por tarjeta. Si lo supera, muestra el mismo mensaje y la reserva sigue con su tarjeta anterior.
- [ ] Una reserva deja de contar cuando se cobra (`confirmed`), se cancela o se reembolsa.

> Como operador, quiero que los programas automáticos no puedan usar el checkout, para que el inventario lo vean personas.

- [ ] El paso 1 del checkout exige un captcha válido (Cloudflare Turnstile, modo Managed) antes de apartar cupo.
  - El mismo formulario (`CheckoutDetailsFields`) lo exige también en el checkout inmediato, que hoy no se ofrece con el flag encendido.
- [ ] Sin captcha válido se muestra: "No pudimos verificar que sos una persona. Probá de nuevo."
- [ ] El servidor valida el captcha con Cloudflare (`siteverify`) y comprueba `success`, el `hostname` y el `action` esperados. Rechaza los tokens usados o vencidos.

> Como staff, quiero enterarme cuando los cupos de una salida se concentran en pocas personas que todavía no pagaron, para revisarla antes del cobro.

- [ ] El sistema alerta (Sentry, nivel warning) cuando en una salida futura se cumplen las dos condiciones:
  - las reservas diferidas sin autorizar ocupan el 50 % o más de la capacidad;
  - esos cupos los tienen **2 identidades o menos**, contando por email y por tarjeta.
- [ ] La alerta trae la salida, el porcentaje y la cantidad de emails y tarjetas distintos, sin datos personales.
- [ ] El job corre cada 6 horas, así que avisa como máximo 4 veces por día por salida.

> Como sistema, quiero que el diferido tenga límites por IP en los dos pasos, para que no se pueda martillar contra la base ni contra OnvoPay.

- [ ] El paso 2 acepta hasta 20 intentos cada 10 minutos por IP.
- [ ] El paso 1 acepta hasta 60 por día por IP, además del límite actual de 10 cada 10 minutos.

## 5. Diseño técnico

Dos fases que se despliegan por separado (§11):

- **Fase A**: topes, límites y alerta. No usa servicios externos nuevos.
- **Fase B**: captcha. Depende de Cloudflare Turnstile y de actualizar el aviso de privacidad.

### 5.1 Tope de cupos por identidad (Fase A)

**Cohorte viva.** Reservas con `status IN ('pending_minimum', 'pending_payment')`, `payment_method_id IS NOT NULL`, salida con `tour_instances.starts_at > now()` y `status <> 'cancelled'`. Es la misma cohorte de `bookings_one_live_per_payment_method` y de `LIVE_BOOKING_STATUSES`. Contar `pending_payment` cierra el hueco del ciclo de cobro: si la autorización falla, la reserva vuelve a `pending_minimum` y sigue contando.

**Claves de identidad.**

- Email: `lower(btrim(customer_email))`. Las reservas con email vacío o NULL se ignoran, para no agrupar por vacío.
- Tarjeta: `card_last4 || '|' || coalesce(card_brand, '')`. Sin el vencimiento: lo escribe el turista al tokenizar, y si OnvoPay no lo valida con el emisor, cambiarlo daría una huella nueva y anularía el tope (revisión de pagos del 2026-10-20). Colisiona más entre personas distintas, pero para bloquear a alguien la otra identidad ya tiene que tener casi 10 cupos vivos. `card_brand` es nullable. Sin el `coalesce`, la huella daría NULL, y una tarjeta sin marca no tomaría el lock (`pg_advisory_xact_lock` es STRICT) ni coincidiría en la suma. OnvoPay no expone un fingerprint de tarjeta, así que se usan los datos que el servidor ya guarda.

**Dónde se aplica.** La regla autoritativa vive en SQL, en un helper interno `deferred_cap_exceeded(p_email, p_card_last4, p_card_brand, p_seats, p_exclude_booking) RETURNS boolean`. Devuelve un booleano en vez de lanzar, porque el cambio de tarjeta necesita un outcome; además arma la huella en un solo lugar. Sin `card_last4` lanza `CARD_DATA_MISSING` (falla cerrado). Lo llaman, en la misma transacción que escriben:

- **`create_deferred_booking`** (`CREATE OR REPLACE`, misma firma de 18 parámetros, conserva el ACL). El helper se llama después de las validaciones existentes y de `tour_instances FOR SHARE`, justo antes del INSERT.
- **`update_booking_payment_method`** (cambio de tarjeta, …044), con la tarjeta nueva y `p_exclude_booking` igual a la propia reserva. Si se supera el tope devuelve un resultado nuevo, `cap_exceeded`, y no cambia la tarjeta. Sin esto, el tope por tarjeta se esquiva: se reserva con la tarjeta C y se pasa la reserva a la tarjeta D, una y otra vez.

**Serialización.** El helper toma dos `pg_advisory_xact_lock` con la forma de dos claves: `(clase, hashtext(clave))`, con una clase para email y otra para tarjeta, siempre en el orden email → tarjeta. Después suma los asientos de la cohorte viva por email y por tarjeta, excluyendo `p_exclude_booking`, y devuelve `true` si alguna suma más `p_seats` supera el tope. `create_deferred_booking` lanza entonces `DEFERRED_CAP_EXCEEDED`, y `update_booking_payment_method` devuelve `cap_exceeded`.

Análisis de deadlock:

- Quien tiene el advisory lock ya tiene sus locks de fila (`tour_holds FOR UPDATE`, `tour_instances FOR SHARE`) y no espera ningún lock de fila de otra transacción.
- `create_hold_atomic` y `reschedule_booking` toman `tour_instances FOR UPDATE`, pero nunca advisory locks.
- No hay triggers en `bookings` ni en `tour_holds` que toquen `tour_instances`.
- Con clases distintas, un email y una tarjeta no comparten espacio de claves, así que el orden no se puede invertir.
- La única espera posible es la del índice único `bookings_one_live_per_payment_method`, ante otra transacción sin confirmar con el mismo `payment_method_id`. Esa tiene la misma tarjeta, así que espera el mismo lock y no se forma un ciclo.

**Tope.** 10 cupos. Constante de SQL, espejada en `shared/constants/bookings.ts` (`DEFERRED_MAX_LIVE_SEATS_PER_IDENTITY`) para el chequeo temprano y los textos. No es configurable desde el panel (§13).

**Chequeo temprano en el paso 1.** `deferred_live_seats_for_email(p_email) RETURNS integer` es de solo lectura y solo la ejecuta service_role. Si los asientos vivos más los pedidos superan el tope, `startDeferredCheckoutAction` corta antes de apartar y de crear el customer. Es solo para no gastar trabajo; la verdad está en el paso 2.

**Rechazo en el paso 2.** Hoy `completeDeferredCheckout` no libera nada cuando el paso 2 falla. Se agrega lo siguiente **solo ante `DEFERRED_CAP_EXCEEDED`**:

- `UPDATE tour_holds SET status = 'released' WHERE id = $hold AND session_token = $token AND status = 'active'`.
- No se usa `releaseHold`, porque también libera holds en `paying`. Si se liberara ante cualquier error, un segundo paso 2 en paralelo (que recibe `HOLD_NOT_ACTIVE`) podría soltar el cupo de una reserva viva y abrir sobreventa.
- El customer de OnvoPay lo limpia `close-payment-intents`, que ya toma holds `released` (`worker/src/charges/customer-cleanup.ts`).
- El error se mapea a `CheckoutErrorKey.DeferredCapExceeded`.

**Idempotencia (spec 0029).** El corte vive en TypeScript: si el hold está `paying` y la reserva ya existe, `completeDeferredCheckout` la devuelve antes de llamar a la RPC. Un paso 2 repetido con el tope lleno por la propia reserva devuelve esa reserva y no choca con el tope.

Alternativas consideradas:

- **Una reserva por salida por persona**: descartada por el operador, que prefiere un tope total.
- **Tope por IP en la base**: la IP no se guarda en las reservas (privacidad) y en Costa Rica las redes móviles comparten IP (CGNAT). Queda solo como rate limit.

### 5.2 Límites por IP (Fase A)

- `RATE_LIMITS.deferredCompletePerIp = { limit: 20, windowSeconds: 600 }`, con el prefijo `deferred-complete:ip`. Se aplica en `completeDeferredCheckoutAction` antes del GET a OnvoPay.
- `RATE_LIMITS.deferredStartPerIpDaily = { limit: 60, windowSeconds: 86400 }`, con el prefijo `deferred-start:ip-day`. Se aplica en el paso 1 junto con `checkoutPerIp` (`checkout:ip`).
  - El techo es holgado por el CGNAT: una IP móvil la comparten muchos turistas.
- Mismo store y misma semántica fail-open que spec 0017.

### 5.3 Alerta de salida concentrada (Fase A)

- **Función SQL** `deferred_hoarding_candidates(p_share numeric, p_max_identities integer)`, de solo lectura y ejecutable solo por service_role.
  - Toma las salidas futuras no canceladas cuya cohorte "diferida sin autorizar" (`pending_minimum`, o `pending_payment` con `authorized_at IS NULL`) ocupe al menos `p_share` de la capacidad, con a lo sumo `p_max_identities` emails distintos o a lo sumo `p_max_identities` tarjetas distintas.
  - Devuelve `instance_id`, `starts_at`, `tour_name`, `capacity`, `held_seats`, `distinct_emails` y `distinct_cards`.
- **Job nuevo del worker**, `watch-deferred-hoarding`, cada 6 horas. Por cada candidata manda un `Sentry.captureMessage` (warning) con fingerprint `['deferred-hoarding', instance_id]` y los datos sin PII: conteos, no emails.
- Los umbrales (`0.5` y `2`) son constantes del worker, que es self-contained (no importa `@shared` en runtime).
- Cuota de Sentry (plan Developer): como máximo 4 eventos por salida por día, y solo cuando hay concentración.

### 5.4 Captcha en el checkout (Fase B)

- **Servicio**: Cloudflare Turnstile, modo Managed.
  - Verificación de servicio externo: aprobado con condiciones (2026-10-19, external-service-validator). Fuentes: developers.cloudflare.com/turnstile/plans, cloudflare.com/turnstile-privacy-policy, cloudflare.com/terms.
  - Alternativa: hCaptcha. Su plan gratis no tiene modo pasivo y recolecta movimientos de mouse y teclas, lo que es peor para el aviso bajo la Ley 8968.
  - El bloque de decisión va a `.claude/memory/decisions.md` al aprobar este spec.
- **Dónde va**: solo en el paso 1, que es el que aparta cupo. El paso 2 ya exige la cookie HttpOnly del paso 1 y su propio límite por IP. Ponerlo ahí además lo dejaría junto al componente de tarjeta (PCI).
- **Cliente**: componente `TurnstileWidget` al final de `CheckoutDetailsFields`.
  - Carga `https://challenges.cloudflare.com/turnstile/v0/api.js` con el nonce de la CSP.
  - Deja el token en el input oculto `cf-turnstile-response`.
  - Pide el token al enviar (`execution: 'execute'`) y uno nuevo en cada reintento.
- **Servidor**: helper `verifyCaptcha(token, action)` en `web/lib/security/captcha.ts`.
  - Hace POST a `https://challenges.cloudflare.com/turnstile/v0/siteverify` con `TURNSTILE_SECRET_KEY`, `remoteip` (`getClientIp`), `idempotency_key` y un timeout de 5 s.
  - Exige `success`, `hostname` dentro de `TURNSTILE_ALLOWED_HOSTNAMES` y `action` igual al esperado (`deferred_start` o `checkout`).
  - Va **después** del throttle por IP y antes del apartado. Así una IP que ya superó el límite no gasta llamadas a `siteverify`.
- **Si Cloudflare no responde**: se rechaza (fail-closed) y se alerta en Sentry (decisión del operador, 2026-10-20). Es distinto del fail-open del rate limit (spec 0017) a propósito: un captcha que se apaga solo deja de proteger justo cuando alguien lo tira.
- **Flag**: con `CAPTCHA_ENABLED=false`, `verifyCaptcha` no se llama y el widget no se renderiza.
- **CSP**: `frame-src https://challenges.cloudflare.com`, solo en las rutas del checkout, con el mismo patrón por ruta que el 3DS. `script-src` no cambia: alcanza con el nonce y `'strict-dynamic'`. Se actualiza el comentario de `csp.ts` que dice que fuera del 3DS no se manda la IP del visitante a terceros.
- **Cuenta y llaves**:
  - El widget va en la cuenta de Cloudflare del operador (los términos no permiten registrarlo por un tercero).
  - El hostname de producción es `reservas.bokaverdecr.com`.
  - Local, CI y previews de Vercel usan la sitekey y el secreto de prueba públicos de Cloudflare.

## 6. Modelo de datos

- **Tabla**: `bookings`, alter (solo índices).
  - `bookings_live_deferred_email_idx` sobre `(lower(btrim(customer_email)))`, parcial `WHERE status IN ('pending_minimum','pending_payment') AND payment_method_id IS NOT NULL`.
  - `bookings_live_deferred_card_idx` sobre `(card_last4, coalesce(card_brand, ''))`, con el mismo `WHERE`.
- **Funciones**:
  - `deferred_cap_exceeded(p_email text, p_card_last4 text, p_card_brand text, p_seats integer, p_exclude_booking uuid) RETURNS boolean`: interna, SECURITY DEFINER, `search_path = ''`, sin EXECUTE para nadie salvo el owner (se le revoca también a service_role).
  - `create_deferred_booking`: `CREATE OR REPLACE`, misma firma.
  - `update_booking_payment_method`: `CREATE OR REPLACE`, misma firma, con el resultado nuevo `cap_exceeded`.
  - `deferred_live_seats_for_email(p_email text) RETURNS integer`: solo service_role.
  - `deferred_hoarding_candidates(p_share numeric, p_max_identities integer) RETURNS TABLE (...)`: solo service_role.
- **Tipos**: las RPC nuevas y el resultado `cap_exceeded` se agregan a mano en `web/types/database.ts`. No se corre `pnpm db:types` (learning del 2026-06-13).
- **Migración**: `supabase/migrations/20261020000063_topes_del_checkout_diferido.sql`.

Sin columnas nuevas.

## 7. Estados y transiciones

No hay estados nuevos. El tope rechaza la creación en `pending_minimum` y el cambio de tarjeta; los dos ya existían. `update_booking_payment_method` suma el resultado `cap_exceeded`, que no cambia ningún estado.

## 8. Casos borde y errores

- **Dos pasos 2 simultáneos de la misma persona**: los advisory locks los serializan. El segundo ve la reserva del primero y, si se pasa del tope, recibe `DEFERRED_CAP_EXCEEDED`.
- **Concurrencia cruzada**: A (email e1, tarjeta c1) y B (email e2, tarjeta c1) a la vez. Se serializan por el lock de tarjeta, sin deadlock (§5.1).
- **Email con mayúsculas o espacios**: se normaliza. `parseCheckoutInput` ya lo guarda en minúsculas y sin espacios, y la comparación usa `lower(btrim())`.
- **Alias de email** (`ana+1@`, puntos de Gmail): esquivan el tope por email. Los frena el tope por tarjeta.
- **Misma persona con otro email y otra tarjeta**: no se pueden vincular. La frenan el captcha y los límites por IP.
- **Tarjeta sin marca** (`card_brand` NULL): la huella usa `coalesce(card_brand, '')`, así que el lock y la suma funcionan igual.
- **Reserva en `pending_payment` cuya autorización falla**: vuelve a `pending_minimum` y sigue contando, porque nunca dejó de contar.
- **Salida cancelada con reservas todavía vivas**, o salida pasada: no cuentan (filtro por `starts_at` y por estado de la salida).
- **Paso 2 repetido tras perder la respuesta**: devuelve la reserva existente antes de la RPC (§5.1).
- **Rechazo del paso 2 por cualquier otro motivo**: no libera nada, igual que hoy. El hold vence solo a los 15 minutos.
- **Un tercero usa el email de una víctima para llenarle el tope**: la víctima recibe los correos `booking_reserved` y puede cancelar desde el enlace. Se acepta, porque hace falta una tarjeta real por cada 10 cupos.
- **El chequeo temprano revela si un email tiene cupos apartados**: es una fuga menor (sí o no, sin detalle), atenuada por el captcha y los límites por IP. El mensaje no dice cuántos cupos ni en qué salidas.
- **Reprogramar**: hoy `reschedule_booking` solo mueve reservas `confirmed`, así que no aplica. Si un spec futuro permite mover reservas vivas, el tope no cambia (son los mismos asientos), pero hay que revisar el filtro por `starts_at`.
- **Reservas anonimizadas**: no son vivas (la retención las conserva mientras lo estén), y una reserva con email vacío se ignora.
- **Captcha vencido** (más de 300 s) o reutilizado: `verifyCaptcha` lo rechaza. El widget pide uno nuevo y el turista reintenta.
- **Cloudflare caído**: fail-closed. Error de captcha en la UI y alerta en Sentry. No se vende mientras dure la caída.
- **Bloqueador que impide el iframe de Cloudflare**: el turista no puede reservar. El mensaje de captcha sugiere desactivar el bloqueador para el sitio.
- **El store de rate limit cae**: fail-open, como en spec 0017.

## 9. Impacto en otras áreas

- **Panel admin**: sin cambios. La alerta llega por Sentry.
- **Página de cambio de tarjeta** (`/booking/[token]/card`): mensaje nuevo para `cap_exceeded`.
- **Emails**: sin cambios.
- **Worker**: un job nuevo, `watch-deferred-hoarding`, cada 6 horas.
- **Reportes y pagos**: sin impacto en montos ni estados.
- **i18n**: textos nuevos en ES y EN para el tope y el captcha.
- **Legal**: el aviso de privacidad tiene que decir que el formulario de reserva usa Cloudflare Turnstile. La IP, la huella TLS, el User-Agent y la página van a Cloudflare, Inc. (EE.UU.). Hay un borrador del texto para la abogada. **La Fase B no se enciende sin el aviso publicado.**
- **PCI (SAQ A-EP)**: `api.js` de Turnstile carga en la misma página que, después del paso 1, muestra el componente de tarjeta de OnvoPay. Entra al inventario de scripts cuando se retome el PCI. No admite SRI.
- **Operación**: un grupo que pase el tope tiene que reservar en partes con personas distintas o pedirlo por WhatsApp para que lo cargue el staff. Con el flag encendido no hay cobro inmediato.
- **Variables de entorno nuevas**:
  - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` y `TURNSTILE_ALLOWED_HOSTNAMES`;
  - `CAPTCHA_ENABLED` (`true`/`false`, por defecto `false`).
  - Van todas en `web/.env.example` y se validan en `web/lib/env.ts`.

## 10. Plan de tests

- **Integración (SQL)**:
  - Tope por email: 10 asientos pasan y 11 fallan.
  - Tope por tarjeta con emails distintos: 10 pasan y 11 fallan. Lo mismo con `card_brand` NULL.
  - Cohorte: `pending_payment` con tarjeta cuenta. `confirmed`, `cancelled`, las salidas pasadas, las salidas canceladas y los emails vacíos no cuentan.
  - Email con mayúsculas y espacios cuenta como el mismo.
  - Concurrencia: dos `create_deferred_booking` en paralelo con la misma identidad, cuya suma supera el tope; pasa exactamente uno. Concurrencia cruzada (e1/c1 y e2/c1) sin deadlock.
  - El cambio de tarjeta que supera el tope devuelve `cap_exceeded` y conserva la tarjeta anterior. El que no lo supera, pasa. La propia reserva se excluye de la suma.
  - `deferred_hoarding_candidates`:
    - 50 % exacto con 2 identidades: entra;
    - 49 %: no entra;
    - 3 identidades: no entra;
    - salida cancelada o pasada: no entra;
    - reserva autorizada: no cuenta.
  - Grants: `deferred_cap_exceeded`, `deferred_live_seats_for_email` y `deferred_hoarding_candidates` no los ejecutan ni anon ni authenticated (`rpc-execute-grants.test.ts`).
- **Integración (acciones)**:
  - El paso 1 corta antes de crear el customer si el email ya está en el tope.
  - El paso 2 devuelve `deferred-cap-exceeded` y deja el hold `released`.
  - Un paso 2 en paralelo con `HOLD_NOT_ACTIVE` no libera el hold `paying` de la reserva ganadora.
  - El paso 2 repetido con el tope lleno por la propia reserva devuelve la misma reserva.
  - El paso 2 respeta el límite por IP, y el paso 1 el techo diario.
  - El worker limpia el customer del hold liberado.
- **Unit**:
  - `verifyCaptcha` con fetch mockeado:
    - `success`;
    - hostname inválido, y hostname de preview permitido;
    - `action` inválida;
    - token vencido o usado;
    - timeout (fail-closed).
  - Con `CAPTCHA_ENABLED=false` no se verifica. Con `=true` y sin token, se rechaza.
  - El job de alerta: el mensaje, el fingerprint y que no lleva PII.
  - CSP: `frame-src` incluye Cloudflare solo en las rutas del checkout.
- **Manual (PR)**: con las sitekeys de prueba de Cloudflare, reservar en el diferido. Con la sitekey de prueba que siempre falla, ver el error de captcha.

## 11. Plan de rollout

- **Fase A** (topes, límites por IP y alerta):
  - Se despliega apenas se apruebe. No lleva flag: el tope es una regla de negocio.
  - La migración …063 es `CREATE OR REPLACE` más índices, sin downtime. Se aplica con el worker andando, porque no cambia firmas.
  - No hay migración de datos. Las reservas existentes cuentan para el tope desde el despliegue, pero no se tocan.
  - Reversible: re-aplicar las versiones de …045 (`create_deferred_booking`) y …044 (`update_booking_payment_method`).
- **Fase B** (captcha), detrás de `CAPTCHA_ENABLED`:
  1. Publicar el aviso de privacidad actualizado, revisado por la abogada.
  2. Crear el widget de Turnstile en la cuenta de Cloudflare del operador y cargar las variables en Vercel.
  3. Probar la CSP en report-only en un preview.
  4. Encender `CAPTCHA_ENABLED=true` en Vercel.
  - Reversible: `CAPTCHA_ENABLED=false`.
- **Comunicar al operador**:
  - el tope de 10 cupos sin cobrar por persona;
  - qué hacer con grupos más grandes (§9);
  - qué significa la alerta en Sentry.

## 12. Métricas de éxito

- Alertas de concentración en Sentry: cada una revisada por el staff. En los primeros 30 días ninguna debería terminar con una salida perdida por reservas falsas.
- Tasa de autorización exitosa al cobrar las reservas diferidas igual o mejor que antes del cambio.
- Menos del 1 % de los pasos 1 rechazados por captcha (eventos en Sentry frente a apartados creados).

## 13. Preguntas abiertas

Resueltas el 2026-10-20 con el operador: tope de 10 cupos, captcha fail-closed y alerta con ≥ 50 % de la capacidad en ≤ 2 identidades.

- [ ] **Pregunta**: ¿Confirmar con Cloudflare la cláusula §2.2.1(h) de sus términos (tarjetas en sitios con servicios Free)? El sitio no recibe el número de tarjeta, pero la redacción es literal. **Dueño**: Kenneth **Antes de**: Fase B
- [ ] **Pregunta**: Texto del aviso de privacidad sobre Turnstile y su base legal bajo la Ley 8968 (consentimiento o necesidad). **Dueño**: abogada **Antes de**: Fase B
