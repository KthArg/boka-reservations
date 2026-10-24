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
