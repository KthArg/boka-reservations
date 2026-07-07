# Changelog — 0028 Cierre de hallazgos del code review integral

Spec: [0028-cierre-hallazgos-code-review-integral.md](./0028-cierre-hallazgos-code-review-integral.md)
Ramas: `fix/0028-dinero` (workstream A), `fix/0028-panel-portal` (workstream B), `chore/0028-deuda-menor-ci` (workstream C)

## 2026-07-06 — Spec aprobado, arranca workstream A (dinero)

**Hecho**:

- Code review integral ejecutado con 5 subagentes (reporte entregado en sesión; hallazgos resumidos en la memoria `pre-production-checklist`).
- Spec 0028 escrito, revisado por spec-reviewer en dos rondas (2 bloqueantes de diseño resueltos: semántica de precios base+temporada con prioridad determinista, y gate de idempotencia por evento en `confirm_booking`) y aprobado por Kenneth.

**Por qué / decisiones**:

- Tres PRs secuenciales en vez de uno gigante (precedente spec 0023).
- Precios: se conserva "base + temporadas" y la temporada gana (opción b del spec-reviewer); la alternativa (prohibir coexistencia) cambiaba el modelo que el formulario ya permite.
- Reserva `cancelled` con pago tardío reembolsado termina `refunded` vía `settle_refund` (semántica 0011 existente, no se pelea contra el pipeline).

**Pendiente**:

- Implementar A1–A8 en `fix/0028-dinero` (migración `20260706000040` + web + worker + tests).
