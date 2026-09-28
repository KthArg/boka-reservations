# 0036 — Tratamiento de datos según el aviso de privacidad

- **Estado**: approved
- **Autor**: Claude (con decisiones del usuario del 2026-09-27)
- **Creado**: 2026-09-27
- **Última actualización**: 2026-09-27
- **Rama**: feat/0036-datos-del-aviso
- **PR**: (cuando aplique)

Aprobación: mismo pedido del usuario del 2026-09-27 que los specs 0034 y 0035. Revisado por spec-reviewer el mismo día; los hallazgos están resueltos en este texto.

## 1. Contexto y motivación

El aviso de privacidad del spec 0034 afirma cosas sobre los datos que hoy la plataforma no cumple:

| Lo que dice el aviso                                                                          | Lo que pasa hoy                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| "Usamos su dirección IP en forma cifrada y por un máximo de 24 horas" (P2)                    | `rate_limits` guarda SHA-256 sin clave de la IP y del correo. Se revierte probando valores: hay 2³² IPv4. La limpieza a las 24 horas sí existe. |
| "Eliminamos su nombre y su correo a los 18 meses; lo que queda ya no contiene sus datos" (P6) | La anonimización deja los datos de tarjeta y el cliente de OnvoPay del cobro diferido, y no toca las reservas en `payment_mismatch`.            |
| "Conservamos el registro de la transacción 5 años, y después lo eliminamos" (P6)              | No hay purga a los 5 años.                                                                                                                      |
| "Puede pedir que corrijamos o eliminemos sus datos; respondemos en 5 días hábiles" (P7)       | La acción de borrado no tiene pantalla, y no hay forma de corregir un nombre o un correo.                                                       |
| "Acceso restringido por funciones" (P8) y "solo en la medida en que lo necesita" (P4)         | El staff exporta todas las reservas, y un usuario desactivado conserva una sesión válida en la base hasta que vence.                            |
| Sin proveedores fuera de la tabla de P4                                                       | La foto de cada tour se carga desde cualquier URL, y ese servidor recibe la IP del visitante.                                                   |
| (spec 0035) Devolución por transferencia o SINPE                                              | Se piden datos de una cuenta que el aviso no declara.                                                                                           |

Para quién: turistas, que son los dueños de los datos, y admin, que atiende los pedidos.

## 2. Objetivos

- Hacer irreversibles las huellas de IP y correo del límite de intentos.
- Dejar cada reserva, a los 18 meses, sin ningún dato que la vincule a la persona, y borrar el registro de la venta a los 5 años.
- Darle al admin pantallas para borrar y corregir los datos de una persona a pedido.
- Restringir el acceso: exportes solo para admin y usuarios desactivados sin sesión.
- Servir las fotos de los tours desde el propio almacenamiento.

## 3. Fuera de alcance

- Los datos del personal y los guías: el aviso en papel quedó fuera por decisión del usuario.
- `audit_logs` es de solo agregado (`…021`) y registra la actividad del personal. El aviso a clientes no promete borrarla, así que no se purga.
- Los datos de tarjeta que el cobro diferido escribe en `audit_logs`: el cobro diferido está apagado, y encenderlo exige su propia actualización del aviso.
- Exportar los datos de una persona (derecho de acceso): se responde por correo con lo que muestra el panel.

## 4. Historias de usuario

> Como turista, quiero que mi IP no pueda recuperarse de lo que guarda la plataforma.

- [ ] Las claves de `rate_limits` son HMAC-SHA256 con el secreto `IDENTIFIER_HASH_SECRET`: la misma IP da la misma clave y sin el secreto no se puede recalcular.
- [ ] La web no arranca en producción sin ese secreto (mismo patrón que `INVITE_SIGNING_SECRET`, spec 0023).

> Como turista, quiero que, pasado el plazo, lo que quede de mi reserva no me identifique.

- [ ] A los 18 meses del tour, la anonimización vacía nombre, correo, datos de tarjeta, cliente y método de pago de OnvoPay, y el comprobante de una devolución por transferencia. También alcanza a las reservas en `payment_mismatch`.
- [ ] A los 5 años del tour se borran la reserva y sus pagos, reembolsos y notificaciones, salvo que tenga un reembolso sin terminar (`pending`, `processing`, `failed` o `awaiting_transfer`).

> Como admin, quiero atender los pedidos de borrado y de corrección.

- [ ] `/dashboard/privacy`, solo para admin, busca por correo y muestra cuántas reservas hay por estado y qué se anonimiza y qué se borra.
- [ ] Si hay un reembolso sin terminar, la vista lo advierte y el botón de borrar no aparece: la persona perdería el aviso de su dinero.
- [ ] El borrado muestra cuántas reservas se anonimizaron y cuántas se borraron, y queda auditado.
- [ ] El detalle de la reserva permite al admin corregir nombre y correo. El cambio queda auditado con el valor anterior y el nuevo.

> Como operador, quiero que cada persona del equipo acceda solo a lo que necesita.

- [ ] Exportar reservas y reportes es solo para admin.
- [ ] Un usuario desactivado no obtiene token nuevo, y al desactivarlo se cierran sus sesiones.

> Como turista, quiero que ver un tour no le entregue mi IP a un tercero.

- [ ] La foto del tour se sube desde el panel a Supabase Storage y la página la sirve desde ahí.
- [ ] La CSP limita `img-src` al propio dominio y al almacenamiento.

## 5. Diseño técnico

**Huellas.** `hashIdentifier` usa `createHmac('sha256', IDENTIFIER_HASH_SECRET)`. El secreto es propio y no se deriva de la llave de Supabase: el spec 0023 separó los secretos de firma de esa llave, y esto sigue esa decisión. `web/lib/env.ts` lo exige en producción. Al cambiar la clave, los contadores de `rate_limits` se reinician una vez, lo cual es inocuo. Todos los usos son en runtime Node (`node:crypto`), así que no hace falta WebCrypto.

**Anonimización.** Se reemplazan `anonymize_bookings_past_retention` y `anonymize_booking_pii_by_email` partiendo de su última versión (`…044`), que conserva las exclusiones de `booking_retention_locked`. Suman:

- el vaciado de `card_brand`, `card_last4`, `card_exp_month`, `card_exp_year`, `customer_external_id` y `payment_method_id`;
- el vaciado de `refunds.transfer_reference`;
- las reservas en `payment_mismatch`, que conservan sus montos, como las pagadas.

**Purga a 5 años.** `purge_financial_records(p_cutoff)` sigue el patrón de las purgas de `…034`. Borra `notifications`, `refunds`, `payments` y `bookings`, en ese orden, de salidas que terminaron antes del corte, ya anonimizadas y sin reembolsos sin terminar. Devuelve los conteos. `retention-windows.ts` define `FINANCIAL_RECORD_RETENTION_YEARS = 5` y `apply-retention` la llama después de anonimizar.

**Pantallas.**

- `/[locale]/(admin)/dashboard/privacy` con `requireRole(Admin)`, la acción nueva `previewCustomerErasure(email)` (conteos por estado y reembolsos sin terminar, sin mostrar datos) y la existente `anonymizeCustomerByEmail`, ahora con Zod.
- Corrección: `correctBookingContact(bookingId, name, email)`, solo admin, con Zod; audita `booking.contact_corrected` con los dos valores.
- Enlace en la barra lateral solo para admin.

**Acceso.**

- Los exportes pasan de `ADMIN_PANEL_ROLES` a `UserRole.Admin`.
- `custom_access_token_hook` devuelve error para un usuario con `active = false`, así que ese usuario no obtiene token nuevo.
- `deactivate_internal_user` se complementa desde la acción del panel con `auth.admin.signOut` de sus sesiones.

**Fotos de los tours.**

- Bucket público `tour-images` en Supabase Storage. Solo admin puede escribir (políticas de Storage).
- El formulario del tour sube la imagen y guarda la URL pública del bucket. Una validación y un CHECK en `tours` exigen que `cover_image_url` sea nula o empiece con la URL del bucket.
- La CSP de `next.config` restringe `img-src` a `'self'` y al dominio de Supabase.

**Texto del aviso** (versión del 2026-09-27; se publica junto con estos cambios):

- P2 suma: "Si tenemos que devolverle dinero por transferencia o SINPE Móvil, le pedimos por correo los datos de una cuenta a su nombre y los usamos solo para esa devolución."
- P6 cubre esos datos dentro de los 18 meses.

## 6. Modelo de datos

- **Tabla** `tours` — CHECK `tours_cover_image_url_check`: `cover_image_url IS NULL` o prefijo del bucket. En producción no hay tours, y en local los datos de prueba se ajustan en la misma migración.
- **Storage**: bucket `tour-images` y sus políticas.
- **Funciones**:
  - `purge_financial_records(p_cutoff timestamptz)`, nueva;
  - `anonymize_bookings_past_retention` y `anonymize_booking_pii_by_email`, reemplazadas;
  - `custom_access_token_hook`, reemplazada con el control de `active`.
- **Migración**: `supabase/migrations/20260927000050_datos_del_aviso.sql`.

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Correo sin reservas**: la vista previa dice que no hay nada que borrar.
- **Reservas vivas (tour futuro)**: se anonimizan igual que hoy; la vista previa lo advierte.
- **Corrección a un correo inválido**: Zod la rechaza.
- **Usuario desactivado con la pestaña abierta**: su próxima renovación de token falla y la sesión termina.
- **Imagen mayor de 5 MB o que no es imagen**: el formulario la rechaza.
- **Falta `IDENTIFIER_HASH_SECRET` en producción**: la web no arranca. Hay que configurarlo en Vercel antes de promover a `main`.

## 9. Impacto en otras áreas

- Panel: pantalla de privacidad, corrección de contacto, subida de fotos y exportes restringidos.
- Worker: un paso más en `apply-retention`.
- Configuración: variable nueva `IDENTIFIER_HASH_SECRET` en `.env.example` y en Vercel.
- Auth: el hook de token.

## 10. Plan de tests

- Unitarios:
  - `hashIdentifier`: estable, depende del secreto y no coincide con SHA-256 plano;
  - el corte de 5 años;
  - la validación de la URL de la imagen.
- Integración SQL:
  - la purga respeta el corte, el orden y los reembolsos sin terminar;
  - la anonimización vacía los campos nuevos y alcanza `payment_mismatch`;
  - el hook niega el token a un usuario inactivo.
- Integración web:
  - vista previa, borrado y corrección;
  - rechazo para staff;
  - exportes rechazados para staff.
- Permisos: `purge_financial_records` en `rpc-execute-grants`.

## 11. Plan de rollout

- Sin flag. Migración antes del código.
- Antes de promover a `main`: `IDENTIFIER_HASH_SECRET` configurado en Vercel.
- Al lanzar no hay datos de más de 5 años: la purga no borra nada hasta 2031.
- La purga es irreversible por diseño (es lo que promete el aviso); por eso solo toca datos anonimizados y sin plata pendiente.

## 12. Métricas de éxito

- Ninguna fila de `rate_limits` con más de 24 horas.
- Ninguna reserva de más de 18 meses con nombre, correo o datos de tarjeta.

## 13. Preguntas abiertas

Ninguna.
