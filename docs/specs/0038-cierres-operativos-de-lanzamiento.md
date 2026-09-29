# 0038 — Cierres operativos de lanzamiento

- **Estado**: approved
- **Autor**: Claude (con pedido del usuario del 2026-09-28)
- **Creado**: 2026-09-28
- **Última actualización**: 2026-09-28
- **Rama**: feat/0038-cierres-operativos
- **PR**: (cuando aplique)

El número 0037 queda reservado para la factura electrónica (Fase 0 de Hacienda). Revisado por spec-reviewer el 2026-09-28; los hallazgos están resueltos en este texto.

**Actualización 2026-09-29 (implementación).** Una cuenta de acceso inexistente devuelve `user_mgmt_account_missing` (no `user_mgmt_not_found`), con un mensaje que pide invitar de nuevo. La fila que queda inactiva pierde también el teléfono. La verificación previa de la migración en producción es `has_table_privilege('postgres', 'auth.users', 'TRIGGER')`: `db push --dry-run` no ejecuta SQL. La limpieza de Sentry cubre también headers (Referer, next-url, cookies) y spans.

## 1. Contexto y motivación

La primera prueba real en producción (2026-09-28) y los pendientes de los specs 0035 y 0036 dejaron seis huecos chicos que conviene cerrar antes de vender. Ninguno cambia reglas de negocio: todos hacen que lo que ya existe funcione sin sorpresas para el admin o el staff. Van juntos porque son el mismo tipo de trabajo (cierre de lanzamiento), cada uno es chico y ninguno depende de otro; el PR se organiza en un commit por punto para revisarlos por separado.

1. **Reenviar invitación falla con cuentas ya confirmadas.** Abrir el enlace de la invitación confirma la cuenta aunque la persona no llegue a fijar la contraseña. Desde ese momento Supabase rechaza `inviteUserByEmail` (`422 email_exists`) y el panel solo dice "No se pudo enviar la invitación", sin registrar el motivo. Hoy la única salida es borrar la cuenta a mano en la base.
2. **Borrar un usuario desde Supabase deja una fila huérfana en el panel.** `public.users` no tiene relación con `auth.users` (los guías no tienen cuenta de acceso, así que una FK es imposible). Si alguien borra la cuenta en el dashboard de Supabase, el usuario sigue en la lista del panel como activo y su correo queda tomado.
3. **Los reembolsos que necesitan una acción solo se ven dentro de cada reserva.** Un reembolso `failed` o uno en `awaiting_transfer` (spec 0035) exige que el admin haga algo, pero no hay ninguna lista que los junte. Quedó como pendiente en el changelog de 0035.
4. **Los errores de pantalla del navegador no llegan a Sentry.** No existe `global-error.tsx`: un error de render en el cliente muestra la pantalla por defecto de Next.js y no se reporta.
5. **El borrado por correo no dice cuántas reservas quedaron retenidas.** `anonymize_booking_pii_by_email` cuenta las reservas vivas que no puede tocar, pero solo lo guarda en `audit_logs`. El admin cree que se borró todo. Pendiente del changelog de 0036.
6. **Las fotos de tours reemplazadas o abandonadas quedan en el bucket para siempre.** La foto se sube antes de guardar el formulario y "Quitar" solo limpia el campo. Pendiente del changelog de 0036.

## 2. Objetivos

- Permitir que el admin reenvíe el acceso a un admin o staff que abrió la invitación y no fijó la contraseña, sin tocar la base.
- Mantener la lista de usuarios del panel coherente con las cuentas de acceso aunque la cuenta se borre fuera del panel.
- Juntar en una bandeja los reembolsos que esperan una acción del operador o que no avanzan.
- Reportar a Sentry los errores de render del navegador sin enviar los enlaces de acceso de las reservas.
- Informar al admin cuántas reservas no se borraron y por qué, y borrar del bucket las fotos que ningún tour usa.

## 3. Fuera de alcance

- No se agrega un botón para **borrar** usuarios desde el panel; sigue existiendo solo desactivar (spec 0010 y migración 042).
- No se cambia la política de contraseñas ni el flujo de invitación para usuarios nuevos.
- La bandeja de reembolsos no tiene acciones propias: enlaza al detalle de la reserva, donde ya están reintentar, pedir transferencia y registrar transferencia.
- No se traducen los motivos de falla de OnvoPay: son texto libre del proveedor y se muestran tal cual, igual que hoy en el detalle.
- No se agrega contador ni aviso de la bandeja en el menú lateral.
- No se agregan `error.tsx` por segmento ni `not-found.tsx`.
- La pantalla de privacidad no calcula las retenidas **antes** de borrar; las informa después.
- La limpieza de fotos no toca otros buckets ni reorganiza las rutas de los archivos.
- No se levanta el worker en producción; el job nuevo corre cuando el worker esté arriba.
- No se retira todavía `/auth/callback` (ver §5.1).

## 4. Historias de usuario

> Como admin, quiero reenviar el acceso a alguien que abrió la invitación y no terminó, para no tener que borrar su cuenta.

- [ ] Si la cuenta de acceso no está confirmada, "Reenviar invitación" manda la invitación como hoy y el panel dice "Invitación reenviada".
- [ ] Si la cuenta ya está confirmada, el mismo botón manda el correo para fijar la contraseña y el panel dice "Le enviamos un correo para fijar la contraseña".
- [ ] Si Supabase frena el envío por el límite de correos, el panel dice que hay que esperar unos minutos y reintentar.
- [ ] Si la cuenta de acceso no existe, el panel dice que la cuenta ya no existe y que hay que invitar a la persona de nuevo.
- [ ] Cualquier otra falla muestra el mensaje genérico y queda en los logs con el código de Supabase.
- [ ] El enlace del correo para fijar la contraseña funciona aunque se abra en otro navegador o en el celular.

> Como admin, quiero que un usuario borrado en Supabase deje de aparecer como activo en el panel, para que la lista refleje quién tiene acceso.

- [ ] Al borrar una cuenta en Auth, se borra su fila en `public.users`.
- [ ] Si esa fila tiene historial, queda **inactiva** y su correo queda libre para invitar de nuevo a la persona.
- [ ] Tener historial en `public.users` no impide borrar la cuenta en Auth.
- [ ] Reactivar una fila cuya cuenta de acceso ya no existe muestra el mensaje de que hay que invitar a la persona de nuevo, y la fila sigue inactiva.

> Como admin o staff, quiero ver en un solo lugar los reembolsos pendientes de algo, para no dejar a un turista sin su dinero.

- [ ] En "Salidas" aparece la bandeja "Reembolsos por resolver" cuando hay al menos uno.
- [ ] La bandeja lista los reembolsos en `awaiting_transfer`, los `failed` y los `pending` o `processing` que llevan más de 24 horas sin cambiar.
- [ ] Cada fila muestra turista, tour, fecha de la salida, monto, estado, desde cuándo espera y el motivo de la falla si lo hay, con enlace al detalle de la reserva.
- [ ] Se ordena del más antiguo al más nuevo.

> Como operador, quiero enterarme de los errores de pantalla que ven los turistas, para corregirlos.

- [ ] Un error de render en el navegador llega a Sentry, en el build de producción.
- [ ] El usuario ve una pantalla bilingüe con un botón para reintentar.
- [ ] Ningún evento enviado a Sentry contiene el token de un enlace de reserva.

> Como admin, quiero saber qué reservas no se borraron al atender un pedido de borrado, para responderle bien a la persona.

- [ ] Después de borrar, la pantalla muestra cuántas reservas quedaron retenidas, explica que tienen un cobro o una salida en curso y que hay que repetir el borrado cuando terminen.
- [ ] Si no quedó ninguna retenida, no aparece el aviso.

> Como operador, quiero que las fotos que ya no usa ningún tour se borren solas, para no acumular archivos.

- [ ] Una vez por día se borran del bucket `tour-images` los archivos que ningún tour referencia y que tienen más de 7 días.
- [ ] Una foto de un tour archivado no se borra.
- [ ] Si la corrida encontraría demasiado para borrar o no puede leer los tours, no borra nada y avisa a Sentry.

## 5. Diseño técnico

### 5.1 Reenviar el acceso y correo de recuperación

- **Plantilla de recuperación con `token_hash`.** Se agrega `supabase/templates/recovery.html` y `[auth.email.template.recovery]` en `supabase/config.toml`. El enlace es `{{ .SiteURL }}/<locale>/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`. Es el patrón de la guía de Supabase para SSR con Next.js (verificación del lado del servidor con `verifyOtp`), y funciona tanto con el flujo PKCE del navegador (el token lleva el prefijo `pkce_`) como con el implícito del cliente de servicio.
  - Asunto: "Fijá tu contraseña de Boka Verde / Set your Boka Verde password".
  - Texto: sirve para los dos casos (la persona pidió restablecer, o el admin le reenvió el acceso): "Recibimos un pedido para fijar o restablecer la contraseña de tu cuenta de Boka Verde. Si fuiste vos, o si te lo envió el administrador, elegí tu contraseña acá", más el aviso de que si no lo pidió puede ignorarlo.
  - El idioma sale de `.Data.locale` de la cuenta, no del idioma de la pantalla desde donde se pidió. Si la cuenta no tiene locale (las creadas antes del spec 0015), cae a `es`, tanto en el texto como en el enlace.
- **Invitación**: también cae a `es` si falta el locale. El diseño del repo pasa a ser el mismo que el de producción.
- **`resendInvite`** busca primero la cuenta con `auth.admin.getUserById(id)`:
  - No existe (`user_not_found`): devuelve `user_mgmt_not_found`, sin invitar. Invitar crearía una cuenta con otro id y desalinearía la fila.
  - Otro error de esa llamada: genérico y log.
  - `email_confirmed_at` vacío: `inviteUserByEmail` como hoy.
  - `email_confirmed_at` con valor: `auth.resetPasswordForEmail(email)` con el cliente de servicio, sin `redirectTo` (el enlace lo arma la plantilla). Devuelve un resultado distinto para que el panel muestre el mensaje de "fijar la contraseña".
  - `over_email_send_rate_limit` (el intervalo por persona o el límite por hora del SMTP) en cualquiera de las dos llamadas: devuelve el error nuevo `user_mgmt_invite_rate_limited`.
  - Cualquier error se registra con `console.error` y el código de Supabase.
- **Cambio de experiencia en "¿Olvidaste tu contraseña?"**: el correo nuevo lleva a `/auth/confirm`, que emite la cookie firmada; la página fija la contraseña con el cliente de servicio y termina en `/login?reset=success` (hoy termina en `/dashboard` con sesión). Es el mismo final que la invitación. `/auth/callback` y la rama de `updatePassword` que usa la sesión quedan para los enlaces viejos, que vencen en una hora; se retiran en un cambio posterior.

### 5.2 Cuentas borradas en Supabase

- Trigger `on_auth_user_deleted` sobre `auth.users`, `AFTER DELETE FOR EACH ROW`, que llama a `public.handle_auth_user_deleted()` (SECURITY DEFINER, `search_path = ''`). Es el patrón documentado de Supabase para mantener una tabla de usuarios propia; se verifica que la migración aplique en producción con `supabase db push --dry-run` antes de aplicarla (§11).
- La función intenta `DELETE FROM public.users WHERE id = OLD.id`. Solo atrapa `foreign_key_violation`; cualquier otro error se propaga y aborta el borrado en Auth, igual que hoy.
- Si la atrapa (la persona tiene historial), hace `UPDATE public.users SET active = false, email = OLD.id || '@cuenta-borrada.invalid'`. El correo sustituto libera el real para volver a invitar a la persona; el historial sigue apuntando al id y el nombre se conserva. `.invalid` es un dominio reservado que nunca recibe correo.
- Supuestos que el diseño necesita y que se dejan escritos en la migración: ninguna FK hacia `public.users` es `DEFERRABLE` (si lo fuera, la violación saltaría al final de la transacción, fuera del bloque que la atrapa, y revertiría el borrado en Auth); el bloque `EXCEPTION` crea una subtransacción que revierte solo el `DELETE`.
- A las funciones de trigger no se les controla `EXECUTE` al dispararse, así que el `REVOKE` habitual no impide que corra cuando GoTrue borra como `supabase_auth_admin`.
- El rollback de `create.ts` (borrar la cuenta de Auth si falla el insert en `public.users`) no se ve afectado: la fila todavía no existe.
- **Reactivar**: `setUserActive(true)` comprueba primero con `auth.admin.getUserById` que la cuenta exista, para admin y staff. Si no existe, devuelve `user_mgmt_not_found` sin escribir nada. Hoy escribe `active = true` y después falla.
- En producción no hay filas huérfanas hoy (verificado el 2026-09-28: el único usuario tiene cuenta), así que no hace falta migrar datos.

### 5.3 Bandeja de reembolsos

- `listRefundsToResolve()` en `web/lib/operations/repository.ts`, con el cliente de servidor (la RLS `refunds_select_admin_staff` ya permite leer a admin y staff).
- Trae los reembolsos en `failed`, `awaiting_transfer`, y `pending` o `processing` con `updated_at` de hace más de 24 horas, con la reserva, la salida y el tour.
- Por reserva se queda con **el reembolso más nuevo por `created_at`**, el mismo criterio que usa el detalle (`admin-detail.ts`), y lo incluye solo si ese está en uno de los estados de arriba. Así la bandeja y el detalle muestran siempre el mismo reembolso. Reintentar o pedir transferencia actualizan esa misma fila, que sale de la bandeja o cambia de estado.
- "Desde cuándo espera": `transfer_requested_at` para `awaiting_transfer`, `updated_at` para los demás.
- El motivo de la falla se muestra tal cual, como en el detalle.
- Componente `RefundTray` en `dashboard/departures`, con el mismo estilo que `ReviewTray`. No se muestra si la lista está vacía.

### 5.4 `global-error.tsx` y Sentry en el navegador

- `web/app/global-error.tsx`, componente cliente que llama a `Sentry.captureException(error)` en un `useEffect` y renderiza su propio `<html>` y `<body>`. Solo se activa en el build de producción; en desarrollo aparece el overlay de Next.js.
- Está fuera de `[locale]`, sin `NextIntlClientProvider`: el texto es bilingüe fijo ("Algo salió mal / Something went wrong") y el botón llama a `reset()`. Los estilos van en un módulo CSS por orden; la CSP ya admite estilos en línea.
- **Inicialización del SDK del navegador**: en `@sentry/nextjs` v10, `sentry.client.config.ts` está en desuso. La configuración pasa a `web/instrumentation-client.ts` (misma DSN, mismo `enabled` solo en producción, mismo `sendDefaultPii: false`) con `onRouterTransitionStart`, y se borra el archivo viejo.
- **Sin tokens en Sentry**: un `beforeSend` y un `beforeSendTransaction` compartidos por el navegador y el servidor reemplazan el segmento que sigue a `/booking/` por `[token]` en `request.url`, en las URLs de los breadcrumbs y en el nombre de la transacción. Se conserva el recorte de `event.user` que ya existe.

### 5.5 Reservas retenidas en el borrado

- `anonymize_booking_pii_by_email` devuelve también `retained_count`. Como cambia el tipo de retorno, la migración hace `DROP FUNCTION` y la vuelve a crear con el mismo cuerpo más la columna nueva, con `REVOKE ... FROM PUBLIC, anon, authenticated` y `GRANT EXECUTE ... TO service_role` explícitos.
- `web/types/database.ts` se actualiza a mano (no se regenera: está curado).
- `anonymizeCustomerByEmail` pasa el número a la pantalla, y `PrivacyErasure` muestra el aviso cuando es mayor que cero.

### 5.6 Limpieza de fotos

- Job `cleanup-tour-images` en el worker, una vez por día. El nombre del bucket se define en el worker (no importa `@shared`).
- Orden: primero lista los objetos de la raíz del bucket `tour-images` paginando (el CHECK de `cover_image_url` obliga a que todos estén en la raíz); después lee `cover_image_url` de **todos** los tours, cualquiera sea su estado, y se queda con el último segmento de la ruta. Listar antes achica la ventana en la que una foto nueva se guarda entre las dos lecturas.
- Candidatos: objetos no referenciados, con `created_at` de hace más de 7 días, que no sean el marcador `.emptyFolderPlaceholder`.
- **Frenos**, porque Storage no entra en los respaldos de la base y el borrado es irreversible:
  - si falla el listado o la lectura de tours, no borra nada y reporta a Sentry;
  - si hay objetos pero ningún tour referencia una foto y hay más de 5 candidatos, no borra nada y reporta a Sentry (protege contra leer la base equivocada);
  - si hay más de 50 candidatos, no borra nada y reporta a Sentry, para revisar a mano.
- Borra en lotes de 100 con el cliente de servicio del worker, que no pasa por las políticas del bucket, y registra cuántos borró.
- Un formulario abierto más de 7 días y guardado después quedaría con la foto borrada; se acepta por lo improbable, y el admin la vuelve a subir.

## 6. Modelo de datos

Migración `supabase/migrations/20260928000051_cierres_operativos.sql`:

- **Función**: `public.handle_auth_user_deleted()`, create. `RETURNS trigger`, SECURITY DEFINER, `search_path = ''`, `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`.
- **Trigger**: `on_auth_user_deleted` sobre `auth.users`, create. `AFTER DELETE FOR EACH ROW`.
- **Función**: `public.anonymize_booking_pii_by_email(text, uuid)`, drop y create. Retorna `TABLE(anonymized_count integer, deleted_count integer, retained_count integer)`. Mismo cuerpo y mismo guard; `REVOKE` y `GRANT EXECUTE ... TO service_role` explícitos.
- **Reversión**: borrar el trigger y su función, y recrear `anonymize_booking_pii_by_email` con el retorno anterior, con su `REVOKE` y su `GRANT`.

Sin tablas ni columnas nuevas.

FK que hacen que una fila no se pueda borrar y quede inactiva: `bookings.checked_in_by`, `tour_instance_guides.assigned_by`, `audit_logs.actor_id`, `tour_instances.minimum_resolved_by` y `business_settings.updated_by`, todas `NO ACTION` y no diferibles. Las de `tour_instance_guides.guide_id`, `guide_access_tokens.guide_id` y `notifications.guide_id` son `CASCADE`, pero solo aplican a guías, que no tienen cuenta de acceso.

## 7. Estados y transiciones

No aplica. No hay estados nuevos; la bandeja lee los estados existentes de `refunds`.

## 8. Casos borde y errores

- **Reenviar a una cuenta confirmada que ya fijó contraseña**: recibe el correo para fijar la contraseña. Es inofensivo; si no lo usa, su contraseña no cambia.
- **Dos reenvíos seguidos**: el segundo choca con el límite de Supabase (en producción, un correo por persona por minuto) y el panel pide esperar. En local el intervalo es de 1 segundo, así que se prueba con un mock.
- **Recuperación de una cuenta sin locale**: el correo sale en español y el enlace usa `es`.
- **Borrar en Auth a la última persona admin**: el trigger la borra o desactiva sin la guarda del panel. El dashboard de Supabase es acceso de superusuario; queda fuera del alcance protegerlo.
- **Borrar en Auth una cuenta sin fila en `public.users`**: el `DELETE` no encuentra nada y el borrado sigue.
- **Reembolso `failed` que se reintenta**: la misma fila pasa a `pending` o `processing`; sale de la bandeja y vuelve solo si queda 24 horas sin avanzar.
- **Reembolso `succeeded` más nuevo que uno `failed` de la misma reserva**: la bandeja mira el más nuevo, así que no aparece.
- **Worker caído**: los reembolsos `pending` se acumulan y aparecen en la bandeja a las 24 horas. Es la forma de ver que el worker no está procesando.
- **Error de render en `/booking/<token>/...`**: el evento llega a Sentry con `[token]` en lugar del token.
- **Error de render dentro de `global-error.tsx`**: Next.js muestra su pantalla mínima; no hay recursión.
- **Foto subida hace menos de 7 días y todavía no guardada**: no se borra.
- **Dos tours con la misma foto**: está referenciada, no se borra.

## 9. Impacto en otras áreas

- **Panel admin**: bandeja nueva en Salidas; mensajes nuevos en Usuarios (envío frenado, fijar contraseña enviado, cuenta inexistente) y en Privacidad (retenidas).
- **Emails**: plantilla de recuperación nueva en el repo e invitación con el diseño de producción; las dos plantillas de Auth de producción se actualizan a mano.
- **Auth**: "¿Olvidaste tu contraseña?" termina en el login en vez de entrar directo al panel.
- **Worker**: job nuevo `cleanup-tour-images`.
- **Observabilidad**: inicialización de Sentry en el navegador movida a `instrumentation-client.ts`; tokens de reserva quitados de los eventos.
- **i18n**: textos nuevos en `es.json` y `en.json`.
- **Pagos y reembolsos**: sin cambios de lógica; la bandeja solo lee.

## 10. Plan de tests

- **Unit (web)**:
  - `resendInvite`: sin confirmar invita; confirmada manda recuperación; frenado; cuenta inexistente; error de `getUserById`; otro error.
  - `setUserActive(true)` con la cuenta inexistente no escribe.
  - Filtro de la bandeja: `failed` con un `succeeded` más nuevo no aparece; varios `failed` de la misma reserva dejan uno; `pending` de menos de 24 horas no aparece; `awaiting_transfer` usa `transfer_requested_at`; orden.
  - `beforeSend` y `beforeSendTransaction`: quitan el token de la URL, los breadcrumbs y la transacción.
- **Unit (worker)**: selección de candidatos (referenciados, más nuevos que 7 días, varios tours con la misma foto, marcador); frenos (sin referencias, más de 50, falla el listado, falla la lectura de tours); paginación.
- **Integración (Supabase local)**:
  - Borrar con `auth.admin.deleteUser` un staff sin historial borra la fila; uno con una entrada en `audit_logs` y otro con `business_settings.updated_by` quedan inactivos con el correo sustituto; borrar una cuenta sin fila no falla.
  - `anonymize_booking_pii_by_email` devuelve `retained_count`: 1 con una reserva retenida, 0 sin retenidas, y una reserva viva pagada (que se anonimiza) no cuenta.
  - Recuperación con un cliente `flowType: 'pkce'`: `resetPasswordForEmail`, lectura del enlace en Mailpit, GET a `/auth/confirm` con redirect y cookie `invite_set`, y contraseña fijada.
  - `resetPasswordForEmail` con el cliente de servicio sobre una cuenta confirmada: Mailpit recibe el enlace a `/auth/confirm?...type=recovery`.
  - La bandeja con RLS: staff la lee.
- **Manual en el PR**: reenviar a una cuenta confirmada y fijar la contraseña desde otro navegador; forzar un error de render en el preview (build de producción) y ver el evento en Sentry.

## 11. Plan de rollout

- Sin feature flag.
- Orden en producción:
  1. Verificar que el **Site URL** de Auth sea `https://reservas.bokaverdecr.com` (lo es desde el 2026-09-28).
  2. Actualizar a mano en el dashboard de Supabase las plantillas **Invite user** y **Reset password** con el HTML final del PR, y probar "¿Olvidaste tu contraseña?". Tiene que ir **antes** del código: con la plantilla vieja, el reenvío a una cuenta confirmada mandaría un enlace que ninguna ruta procesa.
  3. `supabase db push --dry-run` y respaldo; aplicar la migración 051.
  4. Promover a `main`.
- Confirmar que `NEXT_PUBLIC_SENTRY_DSN` esté cargada en el entorno Preview de Vercel para la prueba manual.
- El job de fotos empieza a correr cuando se levante el worker.
- Reversible: la migración trae su bloque de reversión. El resto es código; las plantillas nuevas son compatibles con el código viejo porque `/auth/confirm` ya acepta `recovery`.

## 12. Métricas de éxito

- Ningún admin o staff necesita que se borre su cuenta a mano para recibir un acceso nuevo.
- Cero reembolsos en la bandeja con más de 3 días sin atender.
- Los errores de render del navegador aparecen en Sentry, sin tokens de reserva.

## 13. Preguntas abiertas

Ninguna. Decisiones tomadas por defecto que el usuario puede cambiar al aprobar:

- Una fila con historial cuya cuenta se borró queda inactiva y con el correo liberado (`<id>@cuenta-borrada.invalid`).
- Reactivar una fila sin cuenta se bloquea con un mensaje; no recrea la cuenta.
- La bandeja incluye los reembolsos `pending` o `processing` que llevan más de 24 horas sin avanzar.
- La limpieza de fotos espera 7 días y se frena con más de 50 candidatos.
