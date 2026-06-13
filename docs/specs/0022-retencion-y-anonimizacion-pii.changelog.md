# Changelog — 0022 Retención de datos y anonimización de PII

Registro vivo de la implementación. Lo más reciente arriba.

## 2026-06-13 — Implementación completa (todos los checks verdes)

**Migración `20260613000034_pii_retention_anonymization.sql`:**

- Columna `bookings.anonymized_at timestamptz NULL` (idempotencia + trazabilidad).
- 5 funciones `SECURITY DEFINER` + `search_path=''` (referencias `public.*`) + guard
  `is_public_request()` + `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` (espejo de las
  funciones de dinero, migración …029):
  - `anonymize_booking_pii_by_email(p_email, p_actor_id)` (PRIV-02): anonimiza reservas con
    rastro financiero **o** en `payment_mismatch`; borra las abandonadas (orden
    refunds→payments→bookings por las FKs sin cascade). Audita con sentinel `privacy_erasure`.
  - `anonymize_bookings_past_retention`, `purge_unpaid_bookings`, `purge_expired_access_tokens`,
    `purge_old_notifications` (PRIV-03). Auditan con sentinel `retention_run`.

**Web (PRIV-02):** `web/lib/privacy/anonymize-action.ts` — server action admin-only
(`requireRole(Admin)` + service client). Sin UI (diferida a un spec futuro).

**Worker (PRIV-03):**

- `worker/src/jobs/retention-windows.ts` — constantes de ventana (perfil B: PII 18 meses,
  abandono 90 días, notificaciones 90 días, gracia de tokens 7 días) + `computeRetentionCutoffs`
  (función pura, sin `env`, testeable en unit).
- `worker/src/jobs/apply-retention.ts` — job: kill-switch `RETENTION_ENABLED`, llama las 4
  funciones; pasos independientes (si uno falla, se sigue) y error agregado a Sentry.
- `worker/src/index.ts` — agendado al arranque + cada 24h. `worker/src/env.ts` +
  `worker/.env.example`: `RETENTION_ENABLED` (default `true`).

**Tipos:** `web/types/database.ts` editado **a mano** (anonymized_at + las 5 funciones);
NO se corrió `db:types` (perdería las uniones curadas — ver learnings y changelog 0021).

**Tests:**

- Unit worker `tests/unit/apply-retention.test.ts` (5): cálculo de cutoffs.
- Integración web `tests/integration/retention-anonymization.test.ts` (18): anonimización
  con/sin pago, `payment_mismatch`, idempotencia, normalización de email, borrado de
  dependientes (FK), las 4 funciones de retención, y grants (anon/staff → 42501).
- Integración worker `tests/integration/apply-retention.test.ts` (2): el job purga y respeta
  el kill-switch.

**Checks:** typecheck OK · lint 0 errores · `db reset` 34 migraciones · web 147 unit + 175
integration · worker 69 unit + 18 integration.

**Decisiones de implementación / revisión (spec-reviewer):**

El spec-reviewer halló 3 bloqueantes, incorporados al spec **antes** de codear:

- **FKs `payments`/`refunds` NO cascadean** desde `bookings`, y toda reserva tiene fila en
  `payments` (creada en el checkout) → el borrado elimina explícitamente refunds → payments →
  bookings en orden, en vez de confiar en un cascade inexistente.
- **El worker no resuelve `@shared` en runtime** → las ventanas viven duplicadas en el worker
  (`retention-windows.ts`), no en `shared/`.
- **`audit_logs.entity_type`/`entity_id` son NOT NULL** → los eventos agregados usan sentinel
  (`privacy_erasure` / `retention_run`) + `gen_random_uuid()`.

Otras decisiones:

- **`payment_mismatch`**: la retención **automática** lo conserva (anomalía a revisar); la
  operación **on-request** lo anonimiza (honra el derecho de eliminación sin perder la anomalía,
  ya que no se puede borrar).
- **Cutoffs de los tests** con fechas muy lejanas (3 años / 400 días) para no tocar datos de
  otras suites en la DB de integración compartida.

**Pendiente (no bloqueante, en pre-production-checklist):** el cliente confirma los plazos con
su contador; las constantes se ajustan si difieren. Texto legal de `/privacy` y `/terms` y
registro PRODHAB son responsabilidad del cliente.
