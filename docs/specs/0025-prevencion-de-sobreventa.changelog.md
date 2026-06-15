# Changelog — 0025 Prevención de sobreventa

Spec: [0025-prevencion-de-sobreventa.md](./0025-prevencion-de-sobreventa.md)
Rama: feat/0025-prevencion-sobreventa

## 2026-06-15 — Implementación completa + revisión de subagentes

**Hecho**:

- **Migración `…036_oversell_prevention.sql`**: ALTER de 3 CHECK (`bookings.status` +`overbooked_refunded`, `tour_holds.status` +`paying`, `notifications.kind` +`overbooked_refunded`) y CREATE OR REPLACE de 5 funciones preservando su cuerpo vigente:
  - `confirm_booking`: lock `FOR UPDATE` de la instancia ANTES de decidir; idempotencia ampliada a `('confirmed','overbooked_refunded')` (cubre el camino del reconciliador sin `p_event_id`); en sobrecupo → `overbooked_refunded`, pago `succeeded`, refund total encolado (índice `refunds_one_active_per_booking`), hold `released`, audit `booking.overbooked_refunded`, notif `overbooked_refunded`; camino feliz sin cambios.
  - `create_hold_atomic`: cuenta holds `paying` como ocupados (sin mirar `expires_at`).
  - `cancel_stale_pending_booking`: libera holds `active` **o** `paying`.
  - `settle_refund`: el UPDATE de bookings preserva el terminal `overbooked_refunded` (`AND status <> 'overbooked_refunded'`).
  - `report_refunds_summary`: cuenta `overbooked_refunded` análogo a `refunded`.
- **Capa de aplicación web**: `initCheckout` pasa el hold a `paying` tras crear el payment intent; `checkAvailability` espeja el conteo de `paying`; `releaseHold` libera `active`+`paying`; el webhook re-lee el estado y alerta a Sentry (`booking-overbooked-refunded`) en vez del viejo `booking-overbooked`. Enum `BookingStatus.OverbookedRefunded`; `database.ts` curado a mano; panel (badge + i18n ES/EN status y notif) + filtro (deriva del enum).
- **Worker**: umbral del reconciliador 2h→30 min (define la "ventana de pago"); `fetchBookingStatus` reemplaza a `fetchInstanceCapacity`; alerta de sobreventa nueva; email nuevo `overbooked-refunded` (template ES/EN + `prepareOverbookedEmail` + dispatch + tipo `NotificationKind`).
- **Tests**: reescrito `overbook.test` (borde de capacidad, overbooked_refunded + refund total, idempotencia del reconciliador sin event_id, concurrencia por el último cupo, release del hold `paying` por abandono); `availability.concurrency` (hold `paying` expirado sigue ocupando); `webhook-handler` (overbooked_refunded end-to-end); unit del reconciliador (alerta de sobreventa) y de la plantilla nueva; actualizado el borde de umbral del reconciliador integ a 30 min.
- **Suite verde**: web unit 172, worker unit 75, web integ 183, worker integ 18; lint 0 errores; typecheck limpio; `supabase db reset` con las 36 migraciones OK.
- **Subagentes**: `payment-flow-auditor` y `db-schema-guardian` → sin bloqueantes; `code-reviewer` → sin bloqueantes. Apliqué sus mejoras: `releaseHold` cubre `paying` (cerraba una ventana de cupo huérfano), webhook usa `BookingStatus.OverbookedRefunded` (consistencia), comentarios defensivos (`IF FOUND`, orden del UPDATE de payments), y el test del release del hold `paying`.

**Por qué / decisiones**:

- **`settle_refund` preserva el terminal `overbooked_refunded` (decisión de implementación, no estaba 100% explícita en el spec).** El spec lista `overbooked_refunded` como terminal distinto y pide mostrarlo en el panel (§7, §9); pero `settle_refund` (que cierra el refund encolado) ponía `bookings.status='refunded'` incondicional, lo que lo habría pisado apenas el worker procesara el reembolso (badge transitorio de segundos). Para honrar el terminal, guardé el UPDATE con `AND status <> 'overbooked_refunded'`. El pago igual pasa a `refunded` y el refund a `succeeded` (la plata se devuelve); solo el estado de la reserva se conserva. Sin efecto en el flujo de cancelación normal (esa reserva está `cancelled`, no `overbooked_refunded`). Consecuencia: `report_refunds_summary` cuenta `overbooked_refunded` en sus dos listas (análogo a `refunded`).
- No se implementó el feature flag opcional `OVERSELL_PREVENTION_ENABLED` (§11, marcado "opcional"): la migración es reversible restaurando los cuerpos previos. Se omite para no agregar superficie.
- No se extrajo una constante local en el worker para el literal de estado `'overbooked_refunded'` (lo sugirió code-reviewer como menor): uso único y el archivo del job está al límite de 150 líneas; extraerlo arriesgaba forzar una partición.

**Pendiente**:

- Verificación de estabilidad en navegador (Playwright) de todas las páginas.
- Abrir el PR (lo hace el usuario).

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
