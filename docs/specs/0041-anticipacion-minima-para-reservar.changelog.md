# Changelog — 0041 Anticipación mínima para reservar

## 2026-09-29 — Implementación completa

**Hecho**:

- Migración 054: `business_settings.booking_cutoff_hours` (0 a 72, por defecto 3) con `GRANT UPDATE` de la columna, y `create_hold_atomic` con `HOLD_BOOKING_CLOSED` después de `NOT_FOUND`, `UNAVAILABLE` y `PAST`; sin configuración, `SETTINGS_MISSING`.
- Configuración: campo nuevo en la sección de horas; la action distingue el error de cada campo (`settings_cutoff_out_of_range`) y un campo vacío no pasa a 0.
- Calendario: `getUpcomingInstances(tourId, cutoffHours)` no lista las salidas cerradas; `getBookingCutoffHours()` (cliente de servicio, `cache()`, valor por defecto si falla la lectura).
- Checkout: una salida disponible pero cerrada muestra "Esta salida ya no acepta reservas en línea" con enlace al calendario; cancelada, pasada o inexistente sigue en 404. `HOLD_BOOKING_CLOSED` → `booking-closed`.
- Se corrigió de paso el voseo de `settings_window_out_of_range` ("Ingresá").

**Tests**:

- Integración (`booking-cutoff.test.ts`): dentro del plazo rechaza, fuera acepta, cancelada da `UNAVAILABLE`, pasada da `PAST`, el calendario filtra, con 0 acepta una salida en minutos, admin cambia y staff no, fuera de rango lo rechaza el CHECK. Con la migración aplicada, la suite existente no necesitó cambios en fixtures.
- Unit: rango del campo (0, 3, 72; -1, 73, 2,5 y vacío rechazados) y traducción del error.

**Pendiente**:

- Prueba manual del aviso en la página del checkout en producción.
