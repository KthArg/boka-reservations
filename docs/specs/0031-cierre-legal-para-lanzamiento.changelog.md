# Changelog — 0031 Cierre legal de la plataforma para el lanzamiento

Spec: [0031-cierre-legal-para-lanzamiento.md](./0031-cierre-legal-para-lanzamiento.md)
Rama: fix/0031-cierre-legal-lanzamiento

## 2026-09-22 — Implementación completa

**Hecho**:

- **Dos casillas en el checkout** (`ConsentField.tsx`): `terms` y `privacy_consent`, cada una obligatoria y con enlace a su texto. Se elimina `consent-label` y se agregan `terms-label` y `privacy-consent-label` en ES y EN.
- **Validación en el servidor** (`checkout-input.ts`): `parseCheckoutInput` exige las dos. Un formulario viejo con `consent` se rechaza.
- **Versiones separadas** (`shared/constants/legal.ts`): `TERMS_VERSION` junto a `PRIVACY_NOTICE_VERSION`, ambas en `'2026-06-13'`.
- **Cobro inmediato** (`create.ts`): `consentAccepted` pasa a `legalAccepted` y estampa `consent_*` y `terms_*` con la misma hora.
- **Flujo diferido**: el paso 2 rearma el formulario con las dos casillas, y `create_deferred_booking` recibe `p_terms_version`.
- **Migración `…045`**:
  - columnas `bookings.terms_accepted_at` y `terms_version`;
  - `create_deferred_booking` con 18 parámetros, guard `TERMS_REQUIRED` y permisos explícitos;
  - `purge_stale_holds` nueva;
  - `purge_old_notifications` conserva los pendientes con envío futuro.
- **Página de confirmación**: `isWithinSuccessWindow` (`success-window.ts`) y `SUCCESS_PAGE_WINDOW_HOURS = 24`. Fuera de la ventana, la página se comporta como si la reserva no existiera.
- **Worker**: `HOLD_RETENTION_DAYS = 7` en `retention-windows.ts`, y `apply-retention` llama a `purge_stale_holds` después de `purge_unpaid_bookings`.
- **Tipos**: `web/types/database.ts` editado a mano con las columnas, el argumento y la función nuevos.
- **Tests**:
  - unitarios de las casillas (cada una por separado y el campo viejo), de la ventana de 24 h y del cutoff de holds;
  - integración de las versiones estampadas en los dos flujos, `TERMS_REQUIRED`, la firma de 17 parámetros eliminada y los permisos de las tres funciones;
  - integración del worker (`retention-holds-notifications.test.ts`): cada caso de la purga de holds, la bitácora, el rechazo a `anon`, el orden dentro de `apply-retention` y la purga de notificaciones.

**Por qué / decisiones**:

- `database.ts` no se regenera: el archivo del repo está mantenido a mano, con uniones de estados más estrictas que las generadas, y regenerarlo reescribía 2.200 líneas.
- El orden de las purgas se prueba por integración y no con un mock: una reserva no pagada de hace 120 días sobre un hold liberado desaparece junto con su hold en una sola corrida.
- `retention-anonymization.test.ts` sembraba una notificación `pending` programada para hoy y esperaba que se purgara. Con §5.4 esa fila se conserva a propósito: el test ahora siembra una `sent` vieja, y los casos pendientes los cubre el test del worker.

**Revisión** (db-schema-guardian y code-reviewer, sin bloqueantes). Arreglos:

- Migración: CHECK `bookings_terms_pair_check` (fecha y versión de términos van juntas), `SET lock_timeout = '5s'` y advertencia en el encabezado: revertir las columnas borra evidencia contractual.
- Los nombres de las casillas y su valor pasan a `CheckoutLegalField` y `CHECKOUT_ACCEPTED_VALUE` (`shared/constants/legal.ts`), usados por el formulario, la validación y el paso 2 diferido. La validación compara con el valor marcado, no solo con la presencia del campo.
- Test unitario directo de `parseCheckoutInput` (`checkout-input.test.ts`), incluido el campo `consent` viejo y un valor vacío.
- Worker: el test de la bitácora identifica su fila por el cutoff (comparado como instante: jsonb lo devuelve con `+00:00`) y verifica el conteo; casos nuevos de idempotencia, hold liberado sin cliente y pendiente vieja con envío reciente.
- El spec §6 decía "regenerar `database.ts`"; ahora dice que se actualiza a mano.
- Deuda previa anotada, fuera de alcance: `/checkout/success` no valida el `booking` de la URL con Zod e ignora los errores de lectura.

**Prueba manual** (Supabase local, web en el puerto 3100):

- El checkout muestra las dos casillas sin marcar, cada una con su enlace a `/es/terms` y `/es/privacy`.
- El navegador bloquea el envío sin ninguna, solo con términos o solo con datos; lo permite con ambas.
- Con la validación del navegador desactivada y solo la casilla de términos, el servidor responde el error genérico y no crea hold ni reserva.

**Pendiente**:

- Actualizar el registro de datos personales y su resumen para la abogada (consentimiento, reservas temporales, página de confirmación, cola de correos).
- PR a `dev` (lo mergea el usuario). Después, `db push` de la `…045` a producción.
