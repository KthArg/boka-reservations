# Changelog — 0036 Tratamiento de datos según el aviso de privacidad

Spec: [0036-datos-segun-el-aviso-de-privacidad.md](./0036-datos-segun-el-aviso-de-privacidad.md)
Rama: feat/0036-datos-del-aviso (apilada sobre feat/0035-operacion-de-los-terminos)

## 2026-09-27 — Implementación completa

**Hecho**:

- **Huellas con clave**: `hashIdentifier` es HMAC-SHA256 con `IDENTIFIER_HASH_SECRET`. En
  producción la web no arranca sin el secreto (`web/lib/env.ts`); fuera de ella usa uno de
  desarrollo. Variable nueva en `.env.example` y en CI.
- **Migración `…050`**:
  - la anonimización (a los 18 meses y a pedido) vacía también tarjeta, cliente y método de pago
    de OnvoPay y el comprobante de una transferencia, y alcanza a `payment_mismatch`;
  - `purge_financial_records` borra a los 5 años la reserva anonimizada con sus pagos,
    reembolsos, avisos y enlaces, salvo que tenga un reembolso sin terminar; `apply-retention`
    la llama después de anonimizar;
  - `custom_access_token_hook` niega el token a un usuario desactivado;
  - bucket público `tour-images` (5 MB, JPG/PNG/WebP, escritura solo admin) y CHECK de que la
    foto del tour sea del bucket.
- **Panel**: `/dashboard/privacy` (solo admin) con vista previa sin datos y borrado, que no se
  ofrece si hay un reembolso sin terminar; corrección de nombre y correo en el detalle de la
  reserva (solo admin, auditada con los dos valores, y los avisos pendientes pasan al correo
  nuevo).
- **Acceso**: exportar reservas y reportes es solo para admin (rutas y botones). Desactivar a un
  usuario lo bloquea en Supabase Auth, además del hook.
- **Fotos**: el formulario del tour sube la foto al bucket; la CSP limita `img-src` a lo propio,
  el almacenamiento y la pasarela.

**Decisiones**:

- **Bloqueo en Auth en lugar de `signOut`**: `auth.admin.signOut` necesita el token de la sesión,
  que el panel no tiene. El bloqueo (`ban_duration`) impide renovar el token y volver a entrar, y
  se levanta al reactivar.
- **La anonimización por plazo no respeta `booking_retention_locked`**: 18 meses después del tour
  no hay flujo vivo que proteger, y un pago `pending` huérfano retendría los datos para siempre.
  El borrado a pedido sí la respeta para lo que borra.
- **El CHECK de la foto valida el camino del bucket, no el dominio**: el dominio cambia entre
  entornos. La app valida además el dominio de este entorno.

**Pendiente**:

- `IDENTIFIER_HASH_SECRET` en Vercel antes de promover a `main`.
- Al cambiar la clave de las huellas, los contadores de `rate_limits` se reinician una vez.

## 2026-09-27 — Correcciones de las revisiones

Revisiones de db-schema-guardian y code-reviewer sobre el PR #86.

- La corrección de contacto audita solo los campos que cambiaron (el spec lo registra); revisa el
  error al mover los avisos y no escribe sobre una reserva que se anonimizó en medio.
- La purga no toca `payment_mismatch` ni reservas en revisión, bloquea las candidatas antes de
  borrar y ya no usa tabla temporal.
- La anonimización cancela los avisos pendientes y conserva los ids de OnvoPay de una reserva
  viva de una salida futura (el motor diferido los usa); el borrado a pedido rechaza en SQL si
  hay un reembolso sin terminar (`PENDING_REFUND`).
- Storage: política SELECT para admin (update y remove la necesitan) y `(SELECT auth.jwt())`.
  El CHECK de la foto no acepta espacios ni `..`.
- Reactivar a un usuario informa si el desbloqueo en Auth falla. `img-src` incluye
  `https://*.onvopay.com`. El ejemplo del secreto tiene 32 caracteres o más, y el checklist pide
  cargarlo también en Preview.
- Tests: comprobante y todos los datos de tarjeta vaciados, purga de pagos/reembolsos/avisos e
  idempotencia, reserva vieja sin anonimizar, escape de `_` en la vista previa, reserva ya
  anonimizada en la corrección, y el rechazo del hook por su mensaje. El helper de la purga ya no
  anonimiza reservas de otras suites.

**Pendiente**:

- La pantalla no muestra cuántas reservas quedaron retenidas (vivas) en un borrado; queda en
  `audit_logs`.
- Quitar una foto no borra el archivo del bucket.
