# Changelog — 0029 Cupo mínimo y cobro diferido

Spec: [0029-cupo-minimo-y-cobro-diferido.md](./0029-cupo-minimo-y-cobro-diferido.md)
Rama: feat/0029-cupo-minimo-config (workstream A)

## 2026-09-15 15:20 — Workstream A: esquema, configuración y toggle del mínimo

**Hecho**:

- Migración `20260913000043_minimum_participants_deferred_charge.sql`, solo esquema: columnas del cobro diferido en `bookings`, `payments` y `tour_holds`; estado `pending_minimum`; seis kinds de notificación nuevos; resolución del mínimo por salida en `tour_instances`; tabla de fila única `business_settings` con RLS (lectura admin/staff, escritura admin con `updated_by = auth.uid()`) y grants por columna; allowlist de la red de grants actualizada. Ninguna función escribe estos datos todavía.
- Toggle "Cancelar automáticamente, sin avisar al staff" en el formulario de tours, en su propio componente (`TourMinimumPolicyField`), y página admin `/dashboard/settings` para la ventana de decisión, con entrada en la navegación.
- `BookingStatus.PendingMinimum`, `MinimumResolution`, los `NotificationKind` nuevos, la copia local del worker y `web/types/database.ts` editado a mano. i18n ES/EN, incluidas las etiquetas `notif-*` de los kinds nuevos que usa el detalle de reserva.
- Tests: unitarios del schema de configuración y del parseo del toggle; integración del esquema, de `business_settings` (RLS y grants), de la action de configuración y de las actions de tours con el toggle.
- Verificado a mano con Playwright: guardar la ventana como admin (autor registrado), página en EN, redirección y navegación sin "Configuración" para staff, toggle persistido y conservado tras un error de validación.

**Por qué / decisiones**:

- Desvíos de §6 sugeridos por db-schema-guardian y aceptados, todos sin choque con B ni C:
  - el trigger de inmutabilidad cubre monto **y moneda**, que juntos forman el mandato;
  - `payments_failed_unclosed_idx` va sobre `failed_at` y exige `failed_at IS NOT NULL`: las filas `failed` del flujo vigente no tienen `failed_at` y no deben acumularse en el barrido;
  - el índice de reintentos filtra `pending_minimum` y el de salidas sin resolver excluye las canceladas;
  - CHECK de coherencia en `tour_instances`: disparo si y solo si la resolución es `reached` o `staff_confirmed`; snapshot obligatorio al disparar (con `IS NOT NULL` explícito, porque un CHECK que evalúa a NULL se acepta; lo detectó un test); actor solo en decisiones del staff;
  - `pending_minimum` exige también `customer_external_id`; rangos para `card_exp_month`, `card_exp_year` y `charge_attempts`;
  - índices únicos con nombre descriptivo (`bookings_one_live_per_payment_method`, `payments_one_pending_per_booking`) y grant explícito a `service_role` en `business_settings`.
- El checkbox usa `defaultChecked` y no `checked`: React 19 hace `form.reset()` tras la action y eso desmarcaba en el DOM el checkbox controlado. Lo encontró la prueba manual (el admin perdía su elección tras un error de validación) y el arreglo quedó verificado en el navegador.
- Los tests cierran sesión con `signOut({ scope: 'local' })`: el `signOut()` por defecto es global y cerraba la sesión del navegador de quien corre la suite con el usuario del seed.
- No se audita en `audit_logs` el cambio de la ventana: requiere ampliar los CHECK de `audit_logs` y el spec no lo pide. Queda como sugerencia.
- El bloqueo de archivado con `pending_minimum` y el dispatch de kinds sin plantilla se dejan para B, donde el spec los ubica y donde nacen los writers.

**Pendiente**:

- PR del workstream A a `dev`.
- Workstream B (ver notas).

**Notas para retomar** (requisitos para B):

- Retención: la exclusión de pagos `failed` con `provider_closed_at IS NULL` debe acotarse a `payment_method_id IS NOT NULL`; si no, la purga de 90 días deja de borrar los checkouts abandonados del flujo vigente.
- Worker de notificaciones: `worker/src/jobs/send-notifications.ts` manda cualquier kind sin rama propia al camino de reserva. Con la reserva sin confirmar, la notificación queda cancelada para siempre (unicidad `booking_id, kind`); con la reserva confirmada, sale la plantilla del recordatorio 24h. Antes de encolar los kinds nuevos: lista explícita o `assertNever`, y los desconocidos quedan en `pending`.
- `confirm_booking` (`…040:182`) asume que tras sus filtros el estado es `pending_payment`: con `pending_minimum` confirmaría sin cobro. En el DROP + CREATE de B, reemplazar por un chequeo positivo.
- Gate por `charge_started_at` en `cancel_stale_pending_booking` y en el reconciliador (§5.4).
- No contemplan `pending_minimum`: archivado (`web/lib/tours/archive-action.ts:72`), cancelación del turista y del panel, y la página de éxito del checkout.
- `payments_one_pending_per_booking` es un índice parcial: como árbitro de `ON CONFLICT` exige `ON CONFLICT (booking_id) WHERE status = 'pending'`. Preferir la guarda bajo `FOR UPDATE` de §6.
- Después de B, la migración …043 no tiene rollback seguro (ver su header).
- Si el cobro diferido se extiende a otra pasarela: agregar `payment_method_provider` y llevarlo al índice único.
- `web/.next/types/validator.ts` (artefacto local ignorado) apunta a la ruta vieja `bookings/hoy` y rompe `tsc` local; con un build limpio no aparece.
