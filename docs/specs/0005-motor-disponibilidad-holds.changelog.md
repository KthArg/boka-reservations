# Changelog — 0005 Motor de disponibilidad y holds temporales

Spec: [0005-motor-disponibilidad-holds.md](./0005-motor-disponibilidad-holds.md)
Rama: feat/0005-motor-disponibilidad-holds

## 2026-05-26 — Implementación completa, lista para PR

**Hecho**:

- Migración `20260526000011_create_tour_holds.sql`: tabla `tour_holds` +
  función `create_hold_atomic` con `SELECT FOR UPDATE` para serializar requests concurrentes.
- Tipos `tour_holds` y RPC `create_hold_atomic` añadidos a `web/types/database.ts` manualmente
  (la tabla es nueva; el archivo es auto-generado pero se actualiza a mano hasta el próximo reset).
- `web/lib/db/supabase-service.ts`: cliente Supabase con `service_role` para operaciones
  que requieren bypassear RLS desde server-side.
- `web/lib/booking/availability.ts`: tres funciones exportadas —
  `checkAvailability`, `createHold`, `releaseHold`.
- `worker/src/jobs/release-expired-holds.ts`: job que marca holds expirados cada minuto.
- `worker/src/index.ts`: job registrado con `setInterval` de 60s.
- Tests unitarios (`worker/tests/unit/release-expired-holds.test.ts`) con mock de Supabase.
- Tests de integración (`web/tests/integration/availability.test.ts`): checkAvailability,
  createHold, releaseHold, idempotencia, cupos llenos.
- Tests de concurrencia (`web/tests/integration/availability.concurrency.test.ts`):
  10 requests simultáneos para capacidad 5, carrera de 2 para el último cupo.

**Por qué / decisiones**:

- `capacity_reserved` no se toca al crear holds. La disponibilidad se calcula como
  `capacity_total - capacity_reserved - SUM(holds activos)`. Esto hace el sistema
  correcto incluso si el job de expiración se retrasa, porque `expires_at > NOW()`
  en la query es suficiente.
- `create_hold_atomic` es `SECURITY DEFINER` y tiene `REVOKE EXECUTE FROM PUBLIC` —
  solo puede ser invocada desde el backend con service_role, no desde el cliente.
- La idempotencia se implementa dentro de la función SQL: si ya existe un hold activo
  para el mismo `session_token` + instancia, se devuelve el existente sin crear uno nuevo.

**Pendiente**:

- Nada — feature lista para PR.
