# 0022 — Retención de datos y anonimización de PII (Ley 8968)

- **Estado**: approved
- **Autor**: kenneth
- **Creado**: 2026-06-13
- **Última actualización**: 2026-06-13 (aprobado tras revisión del spec-reviewer; 3 bloqueantes incorporados)
- **Rama**: feat/0022-retencion-y-anonimizacion-pii
- **PR**: #<número> (cuando aplique)

## 1. Contexto y motivación

La re-auditoría del Security Council (`docs/security-audits/2026-06-13-reauditoria-1.md`) dejó dos hallazgos P2 de privacidad que hoy el sistema no puede atender:

- **PRIV-02** — No existe ninguna forma de localizar y borrar/anonimizar la PII de una persona. La Ley 8968 de Costa Rica (PRODHAB) le da al titular el derecho de eliminación de sus datos personales; el sistema no ofrece ningún mecanismo para ejecutarlo. El diseño lo facilita (la PII del turista está concentrada en `bookings` y `notifications`), pero falta el punto de entrada.
- **PRIV-03** — Los datos personales se guardan indefinidamente. No hay política de retención: las reservas conservan nombre y email para siempre, los tokens de acceso vencidos (`booking_access_tokens`, `guide_access_tokens`) nunca se purgan y crecen sin techo, y las notificaciones viejas (con el email del destinatario) tampoco se limpian. Solo `rate_limits` tiene purga (24h).

> Nota de alcance: el enunciado textual de **PRIV-03** en la re-auditoría es estricto —purga de **tokens** de acceso vencidos—. Este spec cierra ese punto (la función de purga de tokens) y, bajo el mismo objetivo de retención mínima de la Ley 8968, incluye además la anonimización de PII de reservas viejas y la purga de reservas no pagadas y de notificaciones antiguas. Es cobertura adicional deliberada, no scope creep hacia etapas futuras del roadmap.

El actor afectado es el **turista** (cuya PII se retiene sin límite y que no puede ejercer su derecho de eliminación) y, secundariamente, el **operador**, que es el responsable legal del tratamiento de datos y necesita herramientas para cumplir la Ley 8968.

La tensión central es entre el **derecho de eliminación** y la **obligación de conservar registros contables/tributarios**. Se resuelve con un principio único: **anonimizar en vez de borrar cuando la reserva tiene rastro financiero** (se conservan montos, fechas y tour, se eliminan los identificadores personales), y **borrar físicamente cuando no lo tiene** (reservas abandonadas que nunca pagaron).

Esta feature provee el **mecanismo** (sistema). La **política** (plazos definitivos, atención de pedidos, registro ante PRODHAB) es responsabilidad del **cliente** y está registrada en el checklist pre-producción.

## 2. Objetivos

- Permitir que el operador atienda un pedido de eliminación de un titular anonimizando toda su PII por email, conservando los registros financieros para contabilidad.
- Aplicar automáticamente una política de retención que anonimice la PII de reservas viejas, purgue reservas no pagadas, tokens vencidos y notificaciones antiguas.
- Dejar trazabilidad en `audit_logs` de cada operación de anonimización y purga, sin filtrar la PII que se está eliminando.
- Mantener los plazos de retención como constantes ajustables, para que el cliente los afine con su contador sin tocar lógica.

## 3. Fuera de alcance

- No se construye UI en el panel admin para disparar la anonimización. La operación PRIV-02 es server-side (función SQL + server action admin-only invocable); la pantalla queda para un spec futuro.
- No se implementa la purga del **registro financiero anonimizado a los ~5 años** (prescripción tributaria): se define la constante, pero el job queda diferido (al lanzar no hay datos cercanos a esa antigüedad, y borrar `bookings` antiguos requiere considerar dependencias; se revisará antes de que aplique).
- No se purga `audit_logs`: tiene un trigger de inmutabilidad append-only que bloquea `DELETE` incluso para `service_role`. Su retención a largo plazo necesita un diseño dedicado y queda fuera.
- No se corrige PRIV-07 (truncar el email en `notifications.last_error`): es un P3 separado. La purga de notificaciones a 90 días reduce su persistencia, pero la truncación en sí no se incluye.
- No se redacta el texto legal del aviso de privacidad ni se hace el registro ante PRODHAB (responsabilidad del cliente, ya en el checklist).
- No se cambia el flujo de checkout, pagos, refunds ni la máquina de estados de `bookings`.
- No se hace backfill ni anonimización retroactiva masiva en el deploy: los jobs procesan los datos según sus plazos a partir de su primera corrida.

## 4. Historias de usuario

> Como operador responsable del tratamiento de datos, quiero anonimizar toda la información personal de un turista a partir de su email, para atender un pedido de eliminación de la Ley 8968 sin perder los registros contables.

Criterios de aceptación:

- [ ] Existe una operación admin-only que, dado un email, anonimiza todas las reservas de ese email **que tienen pago** (sobrescribe `customer_name` y `customer_email`, y el `recipient_email` de sus notificaciones) y conserva montos, fechas, moneda y tour.
- [ ] La misma operación **borra físicamente** las reservas de ese email **sin pago** (abandonadas), junto con sus filas dependientes.
- [ ] La operación es idempotente: ejecutarla dos veces para el mismo email no falla ni produce efectos adicionales (una reserva ya anonimizada se omite).
- [ ] La operación registra en `audit_logs` el hecho (actor, email hasheado o conteo, cantidad de reservas anonimizadas y borradas), **sin** escribir la PII eliminada en el log.
- [ ] La operación normaliza el email (trim + minúsculas) antes de buscar, igual que como se persiste en el checkout.
- [ ] Un email sin reservas devuelve un resultado con conteos en cero, sin error.

> Como operador, quiero que el sistema limite por sí solo cuánto tiempo guarda datos personales, para cumplir el principio de retención mínima de la Ley 8968 sin tener que acordarme de hacerlo a mano.

Criterios de aceptación:

- [ ] Un job del worker corre periódicamente y: (a) anonimiza la PII de reservas con pago cuya fecha de salida del tour es anterior a la ventana de PII (≈18 meses); (b) borra reservas sin pago anteriores a la ventana de abandono (≈90 días); (c) borra tokens de acceso (`booking_access_tokens`, `guide_access_tokens`) vencidos hace más de la gracia (≈7 días); (d) borra notificaciones anteriores a la ventana de notificaciones (≈90 días).
- [ ] Cada paso del job registra en `audit_logs` un resumen con el conteo de filas afectadas, sin PII.
- [ ] El job es idempotente y no re-procesa reservas ya anonimizadas (marca `anonymized_at`).
- [ ] El job tiene un kill-switch por variable de entorno (`RETENTION_ENABLED`, default `true`) que lo desactiva por completo sin redeploy de código.
- [ ] Los plazos viven en constantes del worker (duplicadas localmente, no importadas de `@shared`) y cambiarlos no requiere tocar SQL.
- [ ] Las reservas anonimizadas siguen contando correctamente en los reportes financieros (los montos se conservan).

## 5. Diseño técnico

### Principio de clasificación

Una reserva tiene **rastro financiero** si existe al menos un `payments` asociado en estado `succeeded` o `refunded`. **Importante**: toda reserva nace con una fila en `payments` (estado `pending`, creada en el checkout — `web/lib/booking/create.ts`), así que "sin rastro financiero" NO significa "sin fila en `payments`": significa que ninguno de sus pagos llegó a `succeeded`/`refunded`. Las reservas con rastro financiero se **anonimizan** (se conserva el registro contable); las que nunca tuvieron un pago exitoso se **borran físicamente** (eliminando primero sus dependientes — ver abajo). Las reservas en estado `payment_mismatch` se **conservan siempre** (son anomalías a investigar; nunca se borran ni anonimizan automáticamente por antigüedad).

### Borrado físico y dependencias (FKs)

Las FKs hacia `bookings` no son uniformes: `notifications` y `booking_access_tokens` tienen `ON DELETE CASCADE`, pero **`payments` y `refunds` NO cascadean** (referencian `bookings`/`payments` sin cascade). Por eso borrar una reserva exige eliminar explícitamente, dentro de la misma transacción y en este orden: (1) `refunds` de la reserva, (2) `payments` de la reserva, (3) la fila de `bookings` (sus `notifications` y `booking_access_tokens` se van por cascade). No se alteran las FKs existentes a `ON DELETE CASCADE` (sería un cambio de comportamiento global de borrado); el borrado queda acotado a estas funciones nuevas.

### PRIV-02 — Anonimización por titular (on-request)

- **Función SQL** `anonymize_booking_pii_by_email(p_email text, p_actor_id uuid)` (`SECURITY DEFINER`, `search_path=''` con todas las referencias calificadas como `public.*`, `REVOKE EXECUTE FROM anon, authenticated`, guard `is_public_request()` — consistente con las funciones de dinero). Normaliza el email (trim + minúsculas) y, en una transacción:
  - Reservas del email **con** rastro financiero **o en `payment_mismatch`**, y `anonymized_at IS NULL`: setea `customer_name='ANONIMIZADO'`, `customer_email='anonimizado@anonimizado.local'`, `anonymized_at=now()`; y en sus `notifications`, `recipient_email='anonimizado@anonimizado.local'`. (Las `payment_mismatch` no se pueden borrar —son una anomalía a conservar— pero sí se anonimizan acá para honrar el derecho de eliminación del titular.)
  - Reservas del email **sin** rastro financiero (excluyendo `payment_mismatch`): borrado físico con el orden de dependencias de arriba.
  - Inserta en `audit_logs` una fila agregada: `entity_type='privacy_erasure'`, `entity_id=gen_random_uuid()`, `action='privacy.anonymized_by_email'`, `actor_type='admin'`, `actor_id=p_actor_id`, `metadata={ anonymized_count, deleted_count }` (sin el email ni PII).
  - Devuelve `(anonymized_count int, deleted_count int)`.
- **Server action** `anonymizeCustomerByEmail` en `web/lib/privacy/anonymize-action.ts` (nuevo módulo), con `requireRole(Admin)`; pasa el `id` del admin como `p_actor_id` y llama a la función vía service client. Devuelve el resultado o un error genérico. No se expone en ninguna ruta pública ni en el panel (la UI es un spec futuro).

### PRIV-03 — Retención automática (job del worker)

- **Constantes de ventana**: viven **en el worker** (módulo de constantes del worker o el propio `apply-retention.ts`), **duplicadas localmente, NO importadas de `@shared`** — el worker no resuelve el alias `@shared` en runtime (regla `worker-no-shared-runtime`; mismo patrón que `cleanup-rate-limits.ts` y `reconcile-pending-payments.ts`, que duplican sus umbrales):
  - `PII_RETENTION_MONTHS = 18` — meses tras la fecha de salida del tour para anonimizar PII de reservas con pago.
  - `UNPAID_BOOKING_RETENTION_DAYS = 90` — días tras la creación para borrar reservas sin pago.
  - `NOTIFICATION_RETENTION_DAYS = 90` — días para borrar notificaciones.
  - `EXPIRED_TOKEN_GRACE_DAYS = 7` — gracia tras el vencimiento para borrar tokens.
  - `FINANCIAL_RECORD_RETENTION_YEARS = 5` — definida pero **sin job** (ver fuera de alcance).
- **Funciones SQL** (todas `SECURITY DEFINER`, `search_path=''` calificado, REVOKE de anon/authenticated, guard de identidad; cada una escribe en `audit_logs` con `entity_type='retention_run'`, `entity_id=gen_random_uuid()`, `actor_type='system'`, `metadata={ affected_count }`, y devuelve el conteo):
  - `anonymize_bookings_past_retention(p_cutoff timestamptz)` — anonimiza PII de reservas con rastro financiero, `anonymized_at IS NULL`, cuya `public.tour_instances.starts_at < p_cutoff`. `action='retention.anonymized'`.
  - `purge_unpaid_bookings(p_cutoff timestamptz)` — borra (con el orden de dependencias) reservas sin rastro financiero, excluyendo `payment_mismatch`, con `created_at < p_cutoff`. `action='retention.purged_unpaid'`.
  - `purge_expired_access_tokens(p_cutoff timestamptz)` — borra `booking_access_tokens` y `guide_access_tokens` con `expires_at < p_cutoff`. `action='retention.purged_tokens'`. (Cierre textual de PRIV-03.)
  - `purge_old_notifications(p_cutoff timestamptz)` — borra `notifications` con `created_at < p_cutoff`. `action='retention.purged_notifications'`.
- **Job del worker** `apply-retention` (`worker/src/jobs/apply-retention.ts`), agendado al arranque y luego cada 24h (las purgas son de baja frecuencia), espejo del patrón de `cleanup-rate-limits.ts`. Lee `RETENTION_ENABLED` (default `true`); si está off, no-op con log. Calcula cada cutoff (`now - ventana`) desde las constantes locales y llama a las 4 funciones vía service client. Cada llamada es independiente: si una falla, se loguea (y se reporta a Sentry) y las demás siguen.

### Marca de anonimización

Se agrega `bookings.anonymized_at timestamptz NULL`. Sirve para (a) idempotencia (las funciones omiten reservas ya anonimizadas) y (b) trazabilidad. No es un estado de negocio (no entra en la máquina de estados de `bookings`). La columna se agrega **a mano** a `web/types/database.ts` (no con `pnpm db:types`, que pierde las uniones curadas — ver `learnings`).

### Decisiones de diseño

- **Anonimizar, no borrar** (con pago): conserva la integridad contable. Alternativa descartada: borrado físico universal (rompe reportes y obligación fiscal).
- **Placeholder fijo** (`'ANONIMIZADO'` / `'anonimizado@anonimizado.local'`) en vez de `NULL`: las columnas son `NOT NULL` y el panel/CSV esperan un string; un placeholder claro es legible y no rompe nada. No se i18n-iza (es dato persistido, no UI).
- **Borrado explícito de dependientes en la función** en vez de alterar las FKs a `ON DELETE CASCADE`: mantiene acotado el cambio a estas funciones nuevas, sin tocar la semántica de borrado global de `bookings`/`payments`/`refunds`.
- **Eventos de auditoría agregados con sentinel** (`entity_type='privacy_erasure'`/`'retention_run'`, `entity_id=gen_random_uuid()`): satisface el `NOT NULL` de `audit_logs.entity_type`/`entity_id` sin atar el evento a una reserva concreta (que en estos casos es N reservas o ninguna).
- **Funciones SQL en vez de borrado desde el worker en TypeScript**: atomicidad por operación, mismo patrón de hardening que las funciones de dinero, y auditoría dentro de la transacción.
- **Plazos en constantes + kill-switch**: el job destructivo puede ajustarse o apagarse sin redeploy; al lanzar no hay datos ≥18 meses, así que la anonimización no actúa sobre nada real hasta dentro de 18 meses (margen para confirmar plazos con el contador).

## 6. Modelo de datos

- **Tabla**: `bookings`
- **Acción**: alter
- **Columnas afectadas**:
  - `anonymized_at timestamptz NULL` — marca de cuándo se anonimizó la PII. Nullable, sin default. `NULL` = no anonimizada.
- **Índices**: ninguno nuevo obligatorio. Las funciones de retención filtran por `anonymized_at IS NULL` y unen `tour_instances` por su FK ya indexada; la frecuencia diaria del job no justifica un índice dedicado. (Si el volumen lo pidiera, un índice parcial `(anonymized_at) WHERE anonymized_at IS NULL` es aditivo y futuro.)
- **Migración**: `supabase/migrations/20260613000034_pii_retention_anonymization.sql` — agrega la columna y crea las 5 funciones (`anonymize_booking_pii_by_email` + las 4 de retención), con sus `REVOKE`/grants. Stacked sobre la migración `…033` del spec 0021.

## 7. Estados y transiciones

No aplica. No se introducen ni modifican estados de `bookings`, `payments` ni `notifications`. La marca `anonymized_at` es metadato ortogonal al estado de negocio (una reserva anonimizada conserva su `status`, p. ej. `confirmed`).

## 8. Casos borde y errores

- **Email con mayúsculas/espacios**: se normaliza (trim + lowercase) antes de buscar, igual que el checkout persiste el email.
- **Email sin reservas**: la función devuelve `(0, 0)` sin error.
- **Reserva ya anonimizada** (`anonymized_at` no nulo): se omite (idempotencia), tanto en la operación on-request como en el job.
- **Reserva pagada y luego reembolsada** (`refunded`): tiene rastro financiero → se **anonimiza**, no se borra (el registro contable del reembolso se conserva).
- **Reserva sin pago dentro de la ventana de abandono**: no se toca hasta superar los 90 días.
- **Reserva sin pago con consentimiento registrado**: si nunca pagó y supera los 90 días, se borra junto con su evidencia de consentimiento (no hubo tratamiento comercial; aceptable).
- **Notificación vieja de una reserva aún dentro de la ventana de PII**: la notificación se purga a los 90 días aunque la reserva conserve su PII (la notificación es un log operacional de un email ya enviado).
- **Token aún vigente**: no se toca (solo `expires_at < cutoff`).
- **Reserva en `payment_mismatch`**: la retención **automática** la conserva (ni la borra ni la anonimiza por antigüedad — es una anomalía a revisar). La operación **on-request** la **anonimiza** (no la borra): honra el derecho de eliminación del titular sin perder la anomalía. `purge_unpaid_bookings` la excluye siempre.
- **Borrado con dependientes no-cascade**: al borrar una reserva, la función elimina primero sus `refunds`, luego sus `payments`, y por último la fila de `bookings`. Una reserva "sin pago" igual tiene su `payments` en `pending`/`failed` (creada en el checkout), que se borra explícitamente; sin este orden el `DELETE` fallaría por FK.
- **Operación on-request con el email-placeholder** (`anonimizado@anonimizado.local`): no toca nada, porque esas reservas ya tienen `anonymized_at` no nulo y la guarda de idempotencia las omite (no se "re-anonimiza" en masa).
- **`audit_logs`**: no se purga (trigger de inmutabilidad). Documentado fuera de alcance.
- **Concurrencia**: el worker corre en un solo proceso; las funciones son idempotentes y transaccionales. Una segunda corrida solapada no produce doble efecto (las filas ya procesadas no vuelven a calificar).
- **Falla de una función durante el job**: se captura, se loguea y se reporta a Sentry; las demás funciones del job igual corren. El job vuelve a intentar en la próxima corrida (idempotente).
- **`RETENTION_ENABLED=false`**: el job no ejecuta ninguna purga ni anonimización automática; la operación on-request (PRIV-02) sigue disponible (no depende del flag).

## 9. Impacto en otras áreas

- **Panel admin**: la lista y el detalle de una reserva anonimizada muestran `ANONIMIZADO` / `anonimizado@anonimizado.local` en lugar de nombre y email. Es solo texto; no rompe el render. Sin cambios de código necesarios (se verifica que no haya validación que asuma formato de nombre).
- **Export CSV de reservas**: refleja el placeholder en las filas anonimizadas. Correcto (la PII ya no debe salir).
- **Reportes / métricas**: sin impacto. La anonimización conserva montos, moneda y fechas; los agregados financieros (`report_*`) siguen exactos.
- **Emails / templates / worker**: nuevo job `apply-retention`; sin cambios a templates. A los 18 meses no hay notificaciones pendientes hacia reservas anonimizadas.
- **Pagos / refunds / cancelación**: sin cambios de comportamiento.
- **i18n**: sin textos de UI nuevos (la operación es server-side; el placeholder es dato persistido, no se traduce).
- **Variables de entorno**: nueva `RETENTION_ENABLED` (default `true`), documentada en `worker/.env.example` y validada en `worker/src/env.ts`.

## 10. Plan de tests

Según `testing-practices`:

- **Unit (worker)**: cálculo de los cutoffs desde las constantes de `retention.ts` (ventana → timestamp), con fechas fijas.
- **Integración (PRIV-02, `anonymize_booking_pii_by_email`)**:
  - Reserva con pago `succeeded` → queda con `customer_name='ANONIMIZADO'`, `customer_email` placeholder, `anonymized_at` no nulo; sus notificaciones con `recipient_email` placeholder; los montos intactos.
  - Reserva sin pago → se borra (no existe tras la operación), junto con sus dependientes.
  - Idempotencia: segunda llamada para el mismo email → `(0, 0)` y sin cambios.
  - Email inexistente → `(0, 0)`.
  - Se escribe una fila en `audit_logs` con los conteos y **sin** el email en `metadata`.
  - La función rechaza ejecución por `anon`/`authenticated` (grants), espejo de los tests de `rpc-execute-grants`.
- **Integración (PRIV-03, funciones de retención)**: para cada función, una fila justo dentro y otra justo fuera del cutoff, verificando que solo se procesa la que corresponde; y que cada una escribe su resumen en `audit_logs`.
- **Integración (FK / borrado de dependientes)**: borrar una reserva sin pago elimina también su(s) fila(s) en `payments` (y `refunds` si las hubiera) sin violar FKs; una reserva en `payment_mismatch` NO se borra.
- **Integración (`search_path`)**: las funciones resuelven correctamente con `search_path=''` (todas las referencias `public.*`); se ejecutan tras un `db reset` de la cadena completa de migraciones sin error de resolución.
- **Integración (worker `apply-retention`)**: con `RETENTION_ENABLED=true`, el job invoca las 4 funciones con cutoffs derivados de las constantes y es idempotente en una segunda corrida; con `RETENTION_ENABLED=false`, no toca datos.
- **Test manual documentado en el PR**: ejecutar la action de anonimización contra una reserva de prueba pagada y verificar en el panel que muestra el placeholder y que el reporte de ingresos del período no cambia.

## 11. Plan de rollout

- **No requiere feature flag de producto**, pero el job trae el kill-switch `RETENTION_ENABLED` (default `true`).
- **Migración de DB**: sí — `20260613000034_pii_retention_anonymization.sql` (alter aditivo + funciones). Stacked sobre la `…033` del spec 0021; la rama nace de `fix/0021-...` si el 0021 aún no está mergeado a `dev`, o de `dev` si ya lo está.
- **Tipos generados**: agregar `bookings.anonymized_at` a `web/types/database.ts` **a mano** (no correr `pnpm db:types`, que ensancha/pierde las uniones curadas y rompe el typecheck de código no relacionado — ver `learnings` y el changelog del 0021).
- **Variable de entorno nueva**: `RETENTION_ENABLED` (default `true`) en `worker/.env.example` y validada en `worker/src/env.ts`. Dejarla en `true` en producción.
- **Sin migración de datos / sin backfill**: los jobs procesan según sus plazos desde su primera corrida. Al lanzar no hay datos ≥18 meses, así que la anonimización automática no actúa sobre datos reales por mucho tiempo.
- **Comunicación al operador**: informar que existe la operación de anonimización por email para atender pedidos de eliminación, y que la retención corre sola. El responsable de datos del cliente debe conocer el procedimiento.
- **Reversibilidad**: el código se revierte por revert del PR. La anonimización y las purgas son **irreversibles por diseño** (ese es el punto); el kill-switch `RETENTION_ENABLED` evita corridas no deseadas. La migración es aditiva.
- **Dependencia de cutover**: confirmar los plazos con el contador del cliente (ya en el checklist pre-producción); si difieren, ajustar las constantes antes del go-live.

## 12. Métricas de éxito

- Tras la primera corrida del job, los tokens de acceso vencidos hace más de la gracia en DB son ~0 (verificable con una consulta de conteo).
- 100% de las reservas con pago cuya salida superó la ventana de PII tienen `anonymized_at` no nulo y placeholder en nombre/email.
- Un pedido de eliminación se atiende ejecutando una sola operación que deja un registro en `audit_logs`, sin tocar SQL a mano.
- Los reportes de ingresos del período no cambian antes vs. después de una anonimización (los montos se conservan).

## 13. Preguntas abiertas

Las dudas de diseño que levantó la revisión del spec quedaron resueltas en las secciones 5 y 8: el modelo de auditoría agregada (sentinel `entity_type`/`entity_id`), el borrado explícito de dependientes `payments`/`refunds` dentro de las funciones, y el tratamiento de `payment_mismatch` (se conserva). Queda una sola pregunta abierta, que no bloquea la implementación:

- [ ] **Pregunta**: ¿los plazos del perfil B (PII a 18 meses, abandono a 90 días, notificaciones a 90 días, gracia de tokens a 7 días, registro financiero a 5 años) son correctos para las obligaciones tributarias y de protección de datos del operador? **Dueño**: cliente (con su contador/asesor legal). **Antes de**: cutover a producción. (No bloquea la implementación: los plazos son constantes y la anonimización automática no actúa sobre datos reales hasta dentro de 18 meses.)
