# Changelog — 0026 Limpieza de deuda técnica menor

Spec: [0026-limpieza-deuda-tecnica-menor.md](./0026-limpieza-deuda-tecnica-menor.md)
Rama: chore/0026-deuda-tecnica-menor

## 2026-06-15 — Inicio de implementación

**Hecho**:

- Creé la rama `chore/0026-deuda-tecnica-menor` desde `origin/dev` (que ya tiene 0025 mergeado, PR #49, migración `…036`).
- Inicié el changelog.

**Por qué / decisiones**:

- 0026 ya **no se stackea** sobre 0025: 0025 está en `dev`, así que la rama nace limpia de `dev` (el `confirm_booking` que voy a tocar es el de la migración `…036`).
- **Pregunta abierta §13 resuelta por el usuario (2026-06-15)**: el panel lleva **solo el botón manual** "Actualizar" (sin auto-refresh periódico). Cumple el criterio de aceptación obligatorio con mínima superficie.

**Pendiente**:

- Ítem 1: botón "Actualizar" (`router.refresh()`) en `/dashboard/bookings` + clave i18n ES/EN.
- Ítem 2: guard de `payment_mismatch` dentro de `confirm_booking` (migración nueva con firma ampliada `p_paid_amount_cents`/`p_paid_currency`, ambos callers, `database.ts` a mano, tests).
- Ítem 3: limpieza de la DB de dev por teardown acotado de cada suite que filtre tours.
