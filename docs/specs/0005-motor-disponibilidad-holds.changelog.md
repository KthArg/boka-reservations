# Changelog — 0005 Motor de disponibilidad y holds temporales

Spec: [0005-motor-disponibilidad-holds.md](./0005-motor-disponibilidad-holds.md)
Rama: feat/0005-motor-disponibilidad-holds

## 2026-05-26 10:00 — Inicio de implementación

**Hecho**:

- Spec aprobado y estado actualizado a `approved`.
- Changelog iniciado.

**Pendiente**:

- Migración SQL: tabla `tour_holds` + función `create_hold_atomic`.
- Tipos TypeScript actualizados en `web/types/database.ts`.
- Módulo `web/lib/booking/availability.ts` con las tres funciones.
- Job `worker/src/jobs/release-expired-holds.ts` registrado en el worker.
- Tests: unit (worker) + integración (disponibilidad + concurrencia).
