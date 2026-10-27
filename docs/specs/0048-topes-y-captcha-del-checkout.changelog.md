# Changelog — 0048 Topes anti-acaparamiento y captcha del checkout

Spec: [0048-topes-y-captcha-del-checkout.md](./0048-topes-y-captcha-del-checkout.md)
Rama: feat/0048-topes-y-captcha

## 2026-10-20 — Fase A: topes, límites por IP y alerta

**Hecho**:

- Migración …063:
  - índices parciales de la cohorte viva, uno por email normalizado y otro por huella de tarjeta;
  - helper `deferred_cap_exceeded` con advisory locks de dos claves (clase email 48001, clase tarjeta 48002);
  - el tope en `create_deferred_booking` (`DEFERRED_CAP_EXCEEDED`) y en `update_booking_payment_method` (outcome `cap_exceeded`);
  - `deferred_live_seats_for_email` y `deferred_hoarding_candidates`.
- Web:
  - chequeo temprano en el paso 1;
  - en el paso 2, liberación del hold solo ante el tope, con un UPDATE condicionado a `active` y a la sesión;
  - límites por IP nuevos: paso 2 (20 cada 10 min) y techo diario del paso 1 (60);
  - mensajes nuevos en ES y EN en el checkout y en el cambio de tarjeta.
- Worker: job `watch-deferred-hoarding` cada 6 horas. La lógica pura está en `deferred-hoarding.ts`, testeable sin env.
- Tests:
  - `deferred-cap.test.ts` (SQL): email, tarjeta, marca NULL, cohortes, salidas pasadas o canceladas, concurrencia con la misma identidad y cruzada, cambio de tarjeta y alerta;
  - `deferred-checkout-cap-action.test.ts` (acciones);
  - un caso en `deferred-card-update.test.ts`;
  - grants;
  - unit del job.

**Por qué / decisiones**:

- Tope de 10 cupos, fail-closed del captcha y alerta con ≥ 50 % de la capacidad en ≤ 2 identidades: decisiones del operador del 2026-10-20.
- Al principio las tarjetas de los fixtures pasaron a tener vencimiento al azar (`uniqueCardExpiry`), porque con la tarjeta fija de siempre (visa 4242, 12/2030) las reservas de todos los tests se sumaban contra el tope. Con solo el vencimiento al azar (720 combinaciones), entre las ~80 reservas de `deferred-cap.test.ts` la tarjeta bajo prueba coincidía a veces con otra: hubo flakes en 2 de 3 corridas. Con los últimos 4 también al azar quedó estable en 5 de 5.
- La migración no lleva `SET LOCAL lock_timeout`: el CLI aplica las migraciones fuera de una transacción y la sentencia solo genera un warning. La …046 y la …062 lo tienen sin efecto.
- Revisión de pagos (payment-flow-auditor): la huella de tarjeta deja de usar el vencimiento. Lo escribe el turista al tokenizar, y si OnvoPay no lo valida con el emisor, cambiarlo daba una huella nueva por cada vencimiento. Quedan últimos 4 + marca. Por eso los fixtures pasan a últimos 4 al azar (`randomLast4`) y los asserts que esperaban `'4242'` comparan contra la tarjeta guardada.
- El techo diario del paso 1 cuenta solo los intentos que pasan el límite de 10 minutos. Si no, una IP compartida (CGNAT) se agotaba en segundos por un tercero.
- Revisión de schema (db-schema-guardian): sin bloqueantes. El helper falla cerrado sin `card_last4`, el rollback deja explícito el orden y el encabezado incluye la espera por el índice único.
- Fuera del alcance de la Fase A: los rechazos por tope no quedan en audit_logs ni en Sentry. Alcanza con la alerta de concentración; se suma si hace falta investigar.

**Pendiente**:

- Fase B (captcha): primero el aviso de privacidad (abogada) y la confirmación de la cláusula §2.2.1(h) de Cloudflare.
- Aplicar …063 en producción (`supabase db push`) al promover.

## 2026-10-27 — Aviso de privacidad 2026-10-27 y cláusula de tarjetas de Cloudflare

Decisiones del operador: el aviso lo redacta el operador, sin esperar a la abogada, y la cláusula
§2.2.1(h) de Cloudflare se resuelve sin consultarla (razones en §13 del spec).

**Hecho**:

- Aviso nuevo (`web/content/legal/privacy/2026-10-27.{es,en}.ts`, `PRIVACY_NOTICE_VERSION`,
  registro y espejo del worker). Cambios frente a la 2026-10-05:
  - **§2, párrafo nuevo "Verificación contra programas automáticos"**: Turnstile antes de apartar
    cupos; qué datos van a Cloudflare, que recibimos solo el resultado y que Cloudflare los usa
    también por su cuenta para mejorar la detección.
  - **§2, datos técnicos**: Turnstile se suma como excepción a "no hacemos seguimiento".
  - **§3**: finalidad nueva (proteger el sitio de programas automáticos). La frase "no los
    cedemos a terceros para sus propios fines" pasa a tener la excepción de Cloudflare, y la de
    "no tomamos decisiones automatizadas" se reemplaza: la verificación es automática.
  - **§4 y §5**: párrafo de Cloudflare y su red fuera de Estados Unidos.
  - **§8**: segundo factor obligatorio para el personal del panel (spec 0049).

**Pendiente**:

- Fase B (captcha): decidir si el widget se carga al marcar la casilla de privacidad (§13). Resuelto en la entrada siguiente.

## 2026-10-27 — Fase B: captcha con Cloudflare Turnstile en el paso 1

Decisión del operador: el widget se carga recién al marcar la casilla del aviso de privacidad.

**Hecho**:

- `verifyCaptcha` (`web/lib/security/captcha.ts`): POST a `siteverify` con `remoteip`, `idempotency_key` y timeout de 5 s. Exige `success`, hostname permitido y la acción del paso. Falla cerrado; si Cloudflare no responde, da error o informa `internal-error`, alerta en Sentry (`captcha-siteverify-unavailable`).
- Paso 1 del diferido y checkout inmediato: el captcha va después del throttle por IP y antes del chequeo del tope, que revela si un email tiene cupos apartados. Error nuevo `captcha-failed`, que sugiere desactivar el bloqueador.
- `TurnstileWidget`: se monta con la casilla del aviso marcada, modo `interaction-only`, `reset` con cada respuesta de la action.
- CSP: `frame-src https://challenges.cloudflare.com` solo en `/{locale}/tours/{kind}/checkout`.
- Variables nuevas en `env.ts` y `.env.example`: `CAPTCHA_ENABLED` (por defecto `false`), `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` y `TURNSTILE_ALLOWED_HOSTNAMES`. Con el captcha encendido son obligatorias, y en el deploy de producción de Vercel no se acepta un secreto de prueba.
- Tests: `captcha.test.ts` (13 casos), CSP, `isTurnstileTestSecret`, el corte en `checkoutAction`, y en integración que sin captcha válido el paso 1 no aparta cupo ni crea el customer.

**Por qué / decisiones**:

- En vez de `execution: 'execute'` al enviar, el widget se resuelve al montarse: con la casilla del aviso como disparador, el token suele estar listo antes de enviar, y no hay una espera extra en el botón.
- Las llaves de prueba de Cloudflare responden con hostname `example.com` y sin acción (probado con curl). Sin la excepción, local y CI no podrían probar el flujo.

**Verificado a mano (local, llaves de prueba)**: sin la casilla del aviso no se pide nada a Cloudflare. Con ella aparece el token, y con el secreto que pasa siempre el paso 1 llega al formulario de tarjeta. Con el que falla siempre, se ve el error, el form conserva los datos y se pide un token nuevo.

**Pendiente** (rollout, §11):

1. Crear el widget en la cuenta de Cloudflare del operador (hostname `reservas.bokaverdecr.com`, modo Managed).
2. Cargar las cuatro variables en Vercel con `CAPTCHA_ENABLED=false`, desplegar junto con el aviso 2026-10-27 y probar.
3. Encender `CAPTCHA_ENABLED=true` y hacer redeploy.
