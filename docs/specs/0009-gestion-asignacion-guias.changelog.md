# Changelog — 0009 Gestión y asignación de guías

Spec: [0009-gestion-asignacion-guias.md](./0009-gestion-asignacion-guias.md)
Rama: feat/0009-gestion-asignacion-guias

## 2026-06-01 — Implementación completa, lista para PR

**Hecho**:

- **DB** (3 migraciones, validadas con `supabase db reset`):
  - `users.locale` (`'es'|'en'`, default `'es'`) para el idioma del email del guía.
  - `tour_instance_guides` (tabla puente PK `(tour_instance_id, guide_id)`) + `guide_access_tokens` (hash SHA-256, expiración, `last_used_at`).
  - Generalización de `notifications`: `booking_id` nullable, columnas `tour_instance_id`/`guide_id`, `kind` extendido con `guide_assignment`, CHECK de coherencia, e índice único parcial de asignación.
- **Shared**: `NotificationKind`/`NotificationChannel`/`NotificationStatus` en `constants/notifications.ts`; `GUIDE_TOKEN_TTL_DAYS` y `GuideAssignmentError` en `constants/guides.ts`.
- **Worker**: generalicé la cola para soportar un email sin booking. `send-notifications.ts` ramifica por `kind`; nuevos `prepare.ts` (resolución por tipo), `guide-repository.ts` (instancia + guía + conteo de pasajeros), `guide-token.ts` (emisión del token), template `guide-assignment.ts` ES/EN. `RenderedEmail` movido a `types.ts` (fuente única).
- **Web**: lib `guides/` (hash puro, validación de token, repos del panel y de la vista, Server Action `assign/unassign`), sección `/dashboard/salidas` con asignador (client component) + link de nav, y vista pública `/guia/[token]/proximos-tours`.
- **i18n**: namespace `guides` en `es.json` **y** `en.json`.
- **Tests**: unit worker (template + hash), unit web (hash), integración web (asignación: 7, vista de guía: 4), integración worker (despacho del email + token). Verde end-to-end contra DB real + Mailpit.

**Por qué / decisiones**:

- **El token lo genera el worker, no la Server Action.** La regla hash-only impide recuperar el plano de un token desde su hash, así que no se puede "reutilizar" un token entre requests. El worker crea el plano al despachar, guarda el hash y arma el enlace. Se actualizó el spec (sección 5 + diagrama) para reflejarlo.
- **Tabla puente en vez de `guide_id` en `tour_instances`**, para habilitar multi-guía a futuro sin migración con backfill. La unicidad de un guía por instancia la impone la Server Action (delete + insert), no un constraint.
- **Worker self-contained**: no importa `@shared` en runtime (corre con `tsx`/`tsc` sin resolver de paths); se replicaron el `NotificationKind` y el TTL como constantes locales con comentario.
- **Bug encontrado y corregido durante la implementación**: la versión inicial de la migración de `notifications` dropeaba el `UNIQUE (booking_id, kind)` y lo reemplazaba por un índice parcial. Eso rompía `confirm_booking`, cuyo `ON CONFLICT (booking_id, kind)` no puede usar un índice parcial como arbiter — lo cazaron los tests de integración de `notifications-enqueue` (4 rojos). Fix: conservar el unique original (con `booking_id` nullable, los NULL son distintos, así que las filas de guía no colisionan) y solo agregar el índice parcial de asignación.
- **Idempotencia del email**: a lo sumo uno por `(instancia, guía)`, vía verificación de existencia en la Server Action (no `ON CONFLICT`, que no encaja con el índice parcial), respaldada por el índice a nivel DB.
- **`fileParallelism: false` en la config de integración del worker**: con la DB compartida, el `sendNotifications` de otra suite consumía la notificación de guía pendiente y emitía un segundo token (test no determinista). Mismo patrón que ya tenía web.

**Pendiente**:

- Nada — feature lista para PR.

**Notas para retomar**:

- `database.ts` se mantiene a mano en estilo curado (uniones literales `'es'|'en'`), no es la salida cruda de `supabase gen types` (que da `locale: string`). Verifiqué el parcheo contra el esquema real generado.
- Los módulos web con `import 'server-only'` (token, guide-view, repository) requieren `vi.mock('server-only', () => ({}))` para testearse bajo vitest; el hash puro vive en `guides/hash.ts` (sin guard) para poder unit-testearlo.
- No hay nuevos ítems de pre-producción: el email del guía reusa la config de Resend ya prevista en el checklist.
