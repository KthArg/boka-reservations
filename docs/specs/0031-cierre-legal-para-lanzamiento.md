# 0031 — Cierre legal de la plataforma para el lanzamiento

- **Estado**: approved
- **Autor**: Kenneth (con Claude Code)
- **Creado**: 2026-09-21
- **Última actualización**: 2026-09-22
- **Rama**: fix/0031-cierre-legal-lanzamiento
- **PR**: (sin asignar)

## 1. Contexto y motivación

El 2026-09-21 se armó el registro de datos personales de la plataforma y se revisó en cinco rondas contra el código y contra la Ley 8968, su reglamento (Decreto 37554-JP) y las normas tributarias y de consumidor. El registro y su resumen para la abogada del cliente viven fuera del repo, en la carpeta `legal/` del proyecto.

La mayoría de lo que falta para lanzar es trabajo del cliente, de la abogada o de configuración: redactar el aviso, contratar planes, dominio, llaves de producción (ver `docs/lanzamiento-checklist.md`). Este spec cubre solo lo que exige cambiar el sistema para que el lanzamiento con **cobro inmediato** cumpla lo que el registro declara. El cobro diferido del spec 0029 queda apagado (`DEFERRED_CHARGE_ENABLED=false`), pero su código es compartido y no se rompe.

Son cuatro problemas concretos:

1. **Consentimiento mezclado.** El checkout tiene una sola casilla: "Acepto el aviso de privacidad y los términos y condiciones". El reglamento pide que, cuando el consentimiento sobre los datos va dentro de un contrato, sea una cláusula "específica e independiente" (art. 2.f). Además hoy se guarda una sola versión (`PRIVACY_NOTICE_VERSION`) para dos textos que la abogada va a entregar y actualizar por separado.
2. **Reservas temporales de cupo sin plazo.** La tabla `tour_holds` guarda un código de sesión y, en el flujo diferido, el id del cliente en OnvoPay. Ningún job la purga. La ley exige borrar lo que deja de ser necesario (art. 6.1).
3. **Página de confirmación sin vencimiento.** `/checkout/success?booking=<uuid>` muestra correo enmascarado, tour, fecha y estado a cualquiera que tenga la dirección, sin plazo. La dirección queda en el historial del navegador y en los registros de Vercel.
4. **La purga de la cola de correos borra recordatorios pendientes.** `purge_old_notifications` borra por fecha de creación sin mirar el estado ni la fecha de envío. El recordatorio de 24 h se programa para `starts_at - 24h`; en una reserva hecha con más de 90 días de anticipación, se borra antes de salir. Es un bug funcional que además contradice el registro.

Beneficiarios: el turista (consentimiento válido, menos exposición de sus datos) y el operador (cumplimiento legal, recordatorios que sí salen).

**Supuesto**: la retención corre en el worker (`apply-retention`), que hoy está caído en producción. Levantarlo es un requisito del lanzamiento, no de este spec. Si el spec 0030 (worker en Supabase Cron) se implementa antes, la purga nueva se llama desde la función equivalente de ese modelo.

## 2. Objetivos

- Obtener en el checkout dos aceptaciones independientes y obligatorias, una para los términos y otra para el tratamiento de datos, y guardar la versión y la fecha de cada una.
- Purgar automáticamente las reservas temporales de cupo que ya no sirven.
- Limitar a 24 horas desde la última acción de pago la ventana en que la página de confirmación muestra datos de la reserva.
- Conservar los correos cuyo envío todavía está por venir, y seguir purgando todo lo demás a los 90 días.

## 3. Fuera de alcance

- **El texto del aviso de privacidad y de los términos.** Lo redacta la abogada. Reemplazarlo en `web/locales/*.json` y subir las versiones es un cambio de contenido que se hace cuando llegue, siguiendo §11.
- **Lo que solo aplica con el cobro diferido encendido**: borrar marca, últimos 4 dígitos, vencimiento e ids de OnvoPay al anonimizar; sacar esos datos de la bitácora; una versión propia del texto de autorización de cobro y su verificación en el servidor del paso 2. Mientras tanto, `card-update.ts` sigue estampando `PRIVACY_NOTICE_VERSION` como hoy. Queda para un spec previo a encender el flag.
- **Las reservas temporales referenciadas por una reserva** no se purgan: quedan mientras exista esa reserva (decisión en §5.2).
- **Cambios a la bitácora de auditoría** (`audit_logs`): su plazo es decisión del cliente.
- **Pantalla para atender derechos**, doble factor, sal en las huellas de IP y limpieza de URLs que llegan a Vercel y Sentry. Son mejoras posteriores al lanzamiento.
- **Casilla de marketing.** La plataforma no envía correos comerciales.
- **Consentimiento de guías y personal.** Se obtiene por escrito fuera del sistema.
- **Mostrar las versiones de consentimiento en el panel.** Hoy el detalle de la reserva no muestra ninguna y sigue sin mostrarlas.

## 4. Historias de usuario

> Como turista, quiero aceptar por separado los términos del servicio y el uso de mis datos, para saber exactamente a qué estoy consintiendo.

- [ ] El checkout muestra dos casillas sin marcar: una de términos y condiciones y otra de tratamiento de datos personales, cada una con enlace a su texto.
- [ ] Si falta cualquiera de las dos, la reserva no se crea y el formulario muestra el mismo error de validación que hoy.
- [ ] El servidor rechaza la reserva si falta cualquiera de las dos, aunque el navegador se salte la validación.
- [ ] La reserva creada guarda `consent_at` y `consent_version` (privacidad) y `terms_accepted_at` y `terms_version` (términos).
- [ ] El flujo diferido guarda los mismos cuatro campos y su paso 2 sigue funcionando sin volver a pedir las casillas.

> Como operador, quiero que los datos temporales se borren solos, para no acumular información personal que ya no uso.

- [ ] El job de retención borra las reservas temporales que cumplen las condiciones de §5.2.
- [ ] No se borra una reserva temporal referenciada por una reserva, en estado `active` o `paying`, o con cliente de OnvoPay sin limpiar.
- [ ] Cada corrida registra en la bitácora cuántas filas borró, sin datos personales.

> Como turista, quiero que la página de confirmación no exponga mi reserva indefinidamente.

- [ ] La página muestra los datos durante las 24 horas siguientes a la creación de la reserva o al último inicio de cobro, lo que sea más reciente.
- [ ] Pasado ese plazo, la página muestra el mensaje genérico, sin correo, tour, fecha ni estado.

> Como turista que reservó con mucha anticipación, quiero recibir el recordatorio de 24 h.

- [ ] Una notificación `pending` cuyo envío está programado para el futuro no se borra, aunque se haya creado hace más de 90 días.
- [ ] Se borran las notificaciones `sent`, `failed` o `cancelled` creadas hace más de 90 días, y las `pending` cuyo envío estaba programado hace más de 90 días.

## 5. Diseño técnico

### 5.1 Consentimiento separado

- `ConsentField` muestra dos casillas con nombres de campo `terms` y `privacy_consent`. El campo `consent` desaparece. Textos nuevos en `es.json` y `en.json`: una etiqueta para cada casilla, con enlace a `/terms` y `/privacy`. Redacción propuesta, ajustable por la abogada sin tocar lógica:
  - "Acepto los términos y condiciones."
  - "Autorizo el tratamiento de mis datos personales según el aviso de privacidad."
- `parseCheckoutInput` exige ambos campos. Su forma de salida no cambia: el llamador recibe `null` ante cualquier dato inválido.
- `shared/constants/legal.ts` separa las versiones: `PRIVACY_NOTICE_VERSION` y `TERMS_VERSION`. Ambas arrancan en `'2026-06-13'`, la versión provisional vigente. Cada una se sube por separado cuando cambie su texto.
- `initCheckout` (`create.ts`) reemplaza el parámetro `consentAccepted: boolean` por `legalAccepted: boolean`. `true` significa que el llamador validó ambas casillas; entonces estampa los cuatro campos del lado del servidor. Con `false` no estampa ninguno, igual que hoy con `consentAccepted: false`.
- Flujo diferido, paso 1: valida ambas casillas con el mismo `parseCheckoutInput`.
- Flujo diferido, paso 2: `fieldGetter` en `deferred-checkout-action.ts` reemplaza `consent: 'accepted'` por `terms: 'accepted'` y `privacy_consent: 'accepted'`. Sin este cambio el paso 2 fallaría siempre.
- `create_deferred_booking` recibe `p_terms_version` y estampa `terms_accepted_at` con la misma hora que `consent_at`. `deferred-checkout-complete.ts` pasa `TERMS_VERSION`. Procedimiento de migración en §6.

Alternativa descartada: una sola casilla con dos textos. No cumple el art. 2.f.

### 5.2 Purga de reservas temporales

Nueva función SQL `purge_stale_holds(p_cutoff timestamptz)` con el patrón de las funciones de retención de `…044`: `SECURITY DEFINER`, `search_path = ''`, guarda `is_public_request()`, `REVOKE` a `PUBLIC, anon, authenticated`, `GRANT EXECUTE` explícito a `service_role` y fila de conteo en `audit_logs` (`retention.purged_holds`).

Borra las filas de `tour_holds` que cumplen **todas** estas condiciones:

- `status IN ('released', 'expired', 'converted')`. Nunca `active` ni `paying`.
- `created_at < p_cutoff`.
- Ninguna fila de `bookings` la referencia por `hold_id`.
- `customer_external_id IS NULL OR customer_cleaned_at IS NOT NULL`: no queda cliente de OnvoPay por limpiar.

**Decisión**: todo hold referenciado por una reserva se conserva mientras exista esa reserva, sea cual sea su estado. La clave foránea `bookings.hold_id` lo exige, y el hold guarda solo la cantidad de cupos, un código de sesión aleatorio y, en el flujo diferido, el id del cliente en OnvoPay. Eso incluye los `converted` de reservas pagadas y los `released` o `expired` de reservas canceladas, reembolsadas o con monto que no coincide. El registro de datos se actualiza para declarar esta regla.

Incluir `converted` en la condición de estado es una defensa, no un caso conocido: hoy ningún camino deja un `converted` sin referencia, porque `purge_unpaid_bookings` excluye las reservas con pago `succeeded` o `refunded`, que son justo las que tienen hold convertido.

`retention-windows.ts` agrega `HOLD_RETENTION_DAYS = 7`. Siete días cubren la investigación de un checkout abandonado o un reclamo inmediato de cobro, y la limpieza de clientes de OnvoPay, que corre cada 5 minutos. `apply-retention` llama a la función nueva **después** de `purge_unpaid_bookings`, para que los holds liberados en esa misma corrida puedan borrarse.

`tour_holds` no tiene índice por `created_at`. El barrido diario sin índice es aceptable: la tabla se purga a 7 días y queda pequeña.

### 5.3 Página de confirmación

`checkout/success/page.tsx` agrega `created_at` y `charge_started_at` a la consulta de la reserva. Muestra los datos solo si `ahora - referencia <= 24 h`, donde `referencia = charge_started_at ?? created_at` tomando el más reciente de los dos cuando ambos existen. `charge_started_at` es null en toda reserva con cobro inmediato: la regla no puede depender de que exista. Si no se cumple, la página se comporta como cuando la reserva no existe. La constante `SUCCESS_PAGE_WINDOW_HOURS = 24` vive en `shared/constants/bookings.ts` y la regla en una función pura testeable.

Por qué `charge_started_at`: el cobro manual del panel (y el automático del workstream C de 0029) usa esta página como `returnUrl` de la verificación 3DS, días o semanas después de crear la reserva. Medir desde el último inicio de cobro mantiene la página útil en ese regreso. El comprobante permanente es el correo de confirmación.

### 5.4 Cola de correos

`purge_old_notifications` borra:

- `status IN ('sent', 'failed', 'cancelled') AND created_at < p_cutoff`, y
- `status = 'pending' AND scheduled_for < p_cutoff`.

Así se conserva un recordatorio programado para el futuro, y no quedan para siempre filas `pending` que nunca se enviarán, por ejemplo con `NOTIFICATIONS_ENABLED=false`. Una fila de un tipo sin plantilla no se purga, porque el worker la reprograma cada hora; ese caso ya dispara una alerta de Sentry y se corrige agregando la plantilla.

## 6. Modelo de datos

- **Tabla**: `bookings`
- **Acción**: alter
- **Columnas**: `terms_accepted_at timestamptz NULL`, `terms_version text NULL`. Nullables porque las reservas existentes no las tienen. Sin default.
- **Índices**: ninguno.

- **Función** `create_deferred_booking`: cambia de firma. Como `…044` la creó con `CREATE FUNCTION` y grants atados a sus 17 parámetros, la migración:
  1. `DROP FUNCTION public.create_deferred_booking(uuid, text, text, text, text, integer, integer, integer, integer, text, text, text, text, text, text, smallint, smallint)`.
  2. `CREATE FUNCTION` con 18 parámetros (`p_terms_version text` después de `p_consent_version`) y el mismo cuerpo más el estampado de términos.
  3. Guard `IF p_terms_version IS NULL THEN RAISE EXCEPTION 'TERMS_REQUIRED'`, igual al de `CONSENT_REQUIRED`.
  4. `REVOKE ... FROM PUBLIC, anon, authenticated` y `GRANT EXECUTE ... TO service_role` con la firma nueva.
- **Función** `purge_stale_holds`: nueva (§5.2).
- **Función** `purge_old_notifications`: `CREATE OR REPLACE` con la misma firma (§5.4).
- **Tipos**: actualizar a mano `web/types/database.ts` (el archivo se mantiene a mano; no se regenera).

- **Migración**: `supabase/migrations/20260921000045_cierre_legal_lanzamiento.sql`. Su encabezado documenta que revertir `…044` después de aplicar `…045` exige eliminar también la firma de 18 parámetros de `create_deferred_booking`.

La anonimización no toca las columnas nuevas: igual que `consent_*`, son evidencia del contrato y no identifican a la persona.

## 7. Estados y transiciones

Sin cambios. La purga de reservas temporales solo borra filas en estados terminales y sin reserva asociada.

## 8. Casos borde y errores

- **Formulario de una versión vieja de la página** (con `consent`, sin las casillas nuevas): el servidor lo rechaza. El turista recarga y ve las dos casillas.
- **Reserva temporal liberada con cliente de OnvoPay sin limpiar**: no se borra; se borra en una corrida posterior cuando `close-payment-intents` marque `customer_cleaned_at`.
- **Hold referenciado**: las reservas solo se crean sobre holds `active`, que la purga nunca toca. Aun así, la clave foránea impide borrar un hold referenciado; si un `DELETE` fallara por eso, la corrida aborta y se reintenta al día siguiente.
- **Regreso de 3DS desde el correo "requiere autenticación" pasadas 24 h del inicio del cobro**: la página muestra el mensaje genérico. Es aceptable: el resultado del cobro llega por correo.
- **Corrida de retención concurrente**: el `DELETE` es idempotente; la segunda corrida borra cero filas.
- **Regreso de 3DS de un cobro manual semanas después de la reserva**: `charge_started_at` es reciente y la página muestra los datos.
- **Borde de 24 h**: con 24 h justas se muestran los datos; con cualquier tiempo mayor, no. Se evalúa en UTC con la hora del servidor.
- **Notificación `pending` de una reserva cancelada**: el worker la marca `cancelled` cuando llega su hora, y luego la purga por estado la borra a los 90 días.
- **Reversión del PR con la migración aplicada**: el código viejo llama a `create_deferred_booking` con 17 argumentos y la función ya no existe. Con el flag apagado nadie usa ese camino; si hubiera que revertir con el flag encendido, se revierte también la migración con una nueva que restaure la firma vieja.

## 9. Impacto en otras áreas

- **i18n**: dos etiquetas nuevas en `es.json` y `en.json`; se elimina `consent-label`.
- **Worker**: `apply-retention` hace una llamada más; la constante nueva se duplica en `retention-windows.ts` (el worker no importa `@shared` en runtime).
- **Emails, pagos, reembolsos y reportes**: sin cambios.
- **Documentación**: actualizar el registro de datos personales y su resumen (consentimiento, reservas temporales, página de confirmación, cola de correos) y `docs/lanzamiento-checklist.md`.

## 10. Plan de tests

- **Unit** (`web`): `parseCheckoutInput` devuelve `null` sin `terms`, sin `privacy_consent` y sin ambos; devuelve datos con ambos.
- **Unit** (`web`): `checkout-action` pasa `legalAccepted: true` a `initCheckout`; actualizar `checkout-action.test.ts`.
- **Unit** (`web`): regla de la página de confirmación: 24 h justas muestra; 24 h y 1 ms no muestra; `charge_started_at` null y creada hace 1 h muestra; `charge_started_at` null y creada hace 25 h no muestra; creada hace 10 días con `charge_started_at` de hace 5 minutos muestra.
- **Unit** (`web`): `init-checkout-failures.test.ts` usa `legalAccepted`.
- **Unit** (`worker`): `computeRetentionCutoffs` incluye el cutoff de reservas temporales a 7 días; `apply-retention` llama a `purge_stale_holds` después de `purge_unpaid_bookings`.
- **Integración** (`web`): una reserva inmediata guarda los cuatro campos con las versiones vigentes; con `legalAccepted: false` no guarda ninguno (actualizar `checkout-consent.test.ts` y `checkout-price-authority.test.ts`).
- **Integración** (`web`): el servidor rechaza el checkout sin `terms` y, por separado, sin `privacy_consent`.
- **Integración** (`web`): el paso 2 del flujo diferido completa la reserva (`deferred-checkout-action.test.ts`); el caso "rechaza un formulario sin consentimiento" prueba cada casilla por separado.
- **Integración** (`web`): `create_deferred_booking` guarda `terms_version` y `terms_accepted_at`; rechaza `TERMS_REQUIRED` sin versión; la firma de 17 parámetros ya no existe; la nueva no es ejecutable por `anon` ni `authenticated`. Actualizar `deferred-fixtures.ts` en web y worker.
- **Integración** (`worker`): `purge_stale_holds` borra una `expired` vieja sin referencias y una `converted` vieja sin referencias; (esta última como caso defensivo); conserva una `active`, una `paying`, una `converted` referenciada, una `released` referenciada por una reserva cancelada, una con cliente de OnvoPay sin limpiar y una reciente; rechaza la llamada desde un rol público.
- **Integración** (`worker`): `purge_old_notifications` conserva una `pending` con `scheduled_for` futuro y `created_at` de más de 90 días; borra una `pending` con `scheduled_for` de hace más de 90 días, y una `sent`, una `failed` y una `cancelled` viejas.
- **Manual** (en el PR): checkout en navegador con cada casilla desmarcada por separado.

## 11. Plan de rollout

- **Sin feature flag.** Las casillas nuevas aplican a todas las reservas desde el deploy.
- **Orden**: primero la migración, después la web y el worker. Con el flag diferido apagado el orden es inocuo, pero la migración primero evita que la web nueva llame a una firma que todavía no existe.
- **Migración**: aditiva salvo el cambio de firma de `create_deferred_booking`. Producción ya tiene aplicadas las `…040`–`…044` (2026-09-21); la `…045` se aplica sola con `db push`.
- **Datos existentes**: no se rellenan. Las reservas previas quedan con `terms_*` en null.
- **Cuando llegue el texto de la abogada**: reemplazar `privacy-body` y `terms-body` en ambos idiomas, subir `PRIVACY_NOTICE_VERSION` y `TERMS_VERSION` a la fecha de publicación, y desplegar. Es un cambio de contenido sin spec.
- **Reversión**: ver §8. La purga de reservas temporales se apaga con `RETENTION_ENABLED=false`, igual que el resto de la retención.

## 12. Métricas de éxito

- El 100 % de las reservas creadas después del deploy tienen `consent_version` y `terms_version` no nulos.
- Después de 8 días de corridas no quedan reservas temporales sin reserva asociada con más de 7 días. Las `converted` con reserva viva siguen creciendo con las reservas, como está previsto.
- Ningún recordatorio de 24 h de una reserva confirmada queda sin enviar por la purga.

## 13. Preguntas abiertas

- [ ] **Pregunta**: ¿La abogada acepta la redacción de las dos casillas o quiere dictarla? **Dueño**: Kenneth (consultar a la Dra. Guerrero) **Antes de**: 2026-09-28. No bloquea la implementación: las etiquetas viven en i18n.
