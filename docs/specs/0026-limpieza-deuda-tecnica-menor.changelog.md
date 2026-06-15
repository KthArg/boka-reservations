# Changelog — 0026 Limpieza de deuda técnica menor

Spec: [0026-limpieza-deuda-tecnica-menor.md](./0026-limpieza-deuda-tecnica-menor.md)
Rama: chore/0026-deuda-tecnica-menor

## 2026-06-15 — Implementación de los 3 ítems + verificación de suites

**Hecho**:

- **Ítem 1 — botón "Actualizar" del panel.** Componente cliente `RefreshButton.tsx` (`useRouter().refresh()` de next-intl, conserva URL/filtros) en el header de `/dashboard/bookings`; claves i18n `refresh`/`refresh-pending` ES/EN. Sin Realtime ni auto-refresh periódico (decisión del usuario, §13).
- **Ítem 2 — guard de `payment_mismatch` en `confirm_booking`.** Migración `…037`: `DROP` de la firma de 4 args + `CREATE` de la de 6 (`+p_paid_amount_cents`, `+p_paid_currency`, ambos `DEFAULT NULL`). Orden interno: idempotencia (ahora incluye `payment_mismatch`) → **mismatch** → capacidad/overbooked → confirmar. En mismatch: NO confirma, pago queda `pending`, reserva `payment_mismatch`, audit `booking.payment_mismatch` (espeja `flag_payment_mismatch`, `source='confirm_booking'`). Ambos callers pasan el monto: webhook (`route.ts`) y reconciliación (`confirmRecoveredBooking` ampliado + propagación desde `recover()`). `database.ts` curado a mano. Test nuevo `confirm-booking-mismatch-guard.test.ts` (6 casos: match, mismatch, normalización de moneda, moneda distinta, idempotencia, params omitidos).
- **Ítem 3 — limpieza de DB de dev.** Helper `tests/integration/cleanup.ts` (`deleteToursDeep`: borra tour + descendencia en orden de FK, por ids explícitos). Tres suites que filtraban (`notifications-enqueue` → "Tour notif", `guide-departures` → "Salida ES", `guide-view` → "Catarata ES") ahora lo usan en su teardown. Causa real: borraban solo el tour y los FKs (schedule/instances/bookings/payments/tour_instance_guides) hacían fallar el `delete()` en silencio.
- **Verificación de suites** (DB reseteada, 37 migraciones): web unit **172**, worker unit **75**, web integración **189** (suite completa, 29 archivos), worker integración **18**, lint **0 errores**, typecheck limpio. **Invariante del ítem 3 confirmado**: tras correr la suite de integración completa, `SELECT count(*) FROM tours == 2` (línea base del seed), **0 tours netos**.

**Por qué / decisiones**:

- **Ítem 1 sin test de componente (desvío de §10, documentado).** El repo no tiene infraestructura de tests de componentes (vitest `environment: 'node'`, sin `@testing-library/react`, 0 archivos `.test.tsx`). Levantar jsdom + testing-library para un botón trivial contradice las convenciones (testing-practices marca UI como baja criticidad / frágil / "preferir e2e"). Se verifica por Playwright (ver entrada siguiente) en vez de introducir esa infraestructura.
- **`payment_mismatch` agregado al guard de idempotencia por estado** de `confirm_booking`: un reintento sobre una reserva ya marcada no re-evalúa ni re-audita.
- **Params del guard `DEFAULT NULL` + chequeo condicional**: el guard solo corre si el caller pasa monto/moneda (aditivo; no rompe el camino de 3/4 args). El pago esperado se compara por `(booking_id, external_payment_id)`, moneda normalizada a mayúsculas (igual que 0014).
- **Mensajes de alerta de `reconcile-pending-payments.ts` extraídos a constantes.** El archivo estaba al límite de 150 líneas (anotado en 0025); propagar el monto al caller lo empujó a 154. Constificar los mensajes (que además elimina strings mágicos) colapsó los `alert()` multilínea a una línea y dejó el archivo holgadamente bajo el límite. Sin cambio de comportamiento (los tests verifican conteo/fingerprint, no el texto).
- **Hallazgo de entorno (no es bug de 0026): la suite de integración completa puede fallar por rate-limit de login de GoTrue** cuando se corre todo en un proceso (muchos `signInWithPassword`, incluido `rate-limit.test.ts`). Se confirmó corriendo los suites afectados aislados/en lote (auth, reports, users, rpc-grants → verde) y, tras un `db reset` fresco, la suite completa pasa 189/189. No lo causa ningún cambio de 0026 (no se toca auth).

**Pendiente**:

- Revisión de subagentes (payment-flow-auditor, db-schema-guardian, code-reviewer).
- Verificación de la app entera con Playwright.

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
