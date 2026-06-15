# Changelog — 0025 Prevención de sobreventa

Spec: [0025-prevencion-de-sobreventa.md](./0025-prevencion-de-sobreventa.md)
Rama: feat/0025-prevencion-sobreventa

## 2026-06-15 — Inicio de implementación

**Hecho**:

- Creé la rama `feat/0025-prevencion-sobreventa` (desde el branch que ya tiene el spec aprobado).
- Inicié el changelog.

**Por qué / decisiones**:

- Ninguna decisión nueva todavía; se sigue el diseño aprobado del spec (ventana de pago 30 min, estado terminal `overbooked_refunded`, hold `paying`, auto-refund total).

**Pendiente**:

- Migración `…036` (CHECKs + reescritura de `confirm_booking`/`create_hold_atomic`/`cancel_stale_pending_booking`/`settle_refund`/`report_refunds_summary`).
- Capa de aplicación (web + worker) y email nuevo.
- Tests + verificación en navegador.
