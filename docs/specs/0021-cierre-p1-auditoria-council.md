# 0021 — Cierre de condiciones P1 de la auditoría del Security Council

- **Estado**: implemented
- **Autor**: kenneth
- **Creado**: 2026-06-12
- **Última actualización**: 2026-06-14 (mergeado a `dev`; P1-2 se aplica con `supabase config push` en el cutover, no a mano)
- **Rama**: fix/0021-cierre-p1-auditoria-council
- **PR**: #40

## 1. Contexto y motivación

La auditoría final del Security Council (`docs/security-audits/2026-06-12-auditoria-final.md`) emitió un veredicto global **GO CON CONDICIONES**: sin hallazgos P0, pero con tres condiciones P1 a cerrar antes del primer deploy a producción con dinero y datos reales de turistas. Este spec cubre el cierre de las dos condiciones que son **cambios de código** y documenta la tercera, que es una **verificación de dashboard** que solo el operador del proyecto puede ejecutar.

Las tres condiciones P1:

- **P1-1 (ACCESS-01)** — La página pública de éxito de checkout (`/[locale]/checkout/success`) muestra `customer_name` y `customer_email` de cualquier reserva leyéndola por su UUID crudo en la URL, con `service_role` (que saltea RLS), sin token ni verificación de propiedad. Es un IDOR / Broken Object Level Authorization: el UUID viaja en texto en la URL (historial del navegador, logs de servidor/CDN, header `Referer` hacia analytics de terceros, enlaces compartidos), y quien lo obtenga lee el nombre y email del turista. Contradice el patrón correcto de token hasheado que el propio proyecto usa en `/booking/[token]`.
- **P1-3 (PRIV-01)** — El checkout recolecta nombre y email del turista sin punto de consentimiento ni aviso de privacidad. La Ley 8968 de Costa Rica (PRODHAB) exige consentimiento informado para el tratamiento de datos personales. El cumplimiento pleno es del cliente (operador), pero el sistema debe ofrecer el mecanismo, no impedirlo.
- **P1-2 (INFRA-01)** — `enable_signup=false` está en `supabase/config.toml` (local), pero es un setting del servidor: debe confirmarse en el dashboard de Supabase de **producción**. Si el proyecto hosted tiene el auto-registro habilitado, se reabre el vector de lectura de PII de guías que cerró el spec 0020. No es código: ya existe el flag en config y el test `signup-disabled.test.ts`. Se documenta acá como acción manual obligatoria de rollout.

El actor afectado es el **turista** (cuya PII se expone en P1-1 y cuyos datos se recolectan sin consentimiento en P1-3).

## 2. Objetivos

- Eliminar la exposición del email completo y del nombre del turista en la página pública de éxito de checkout, mostrando a lo sumo el email enmascarado, sin introducir nueva infraestructura de tokens.
- Incorporar un punto de consentimiento obligatorio en el checkout, validado server-side y registrado como evidencia en la reserva, con enlaces a aviso de privacidad y términos.
- Dejar documentada y trazable la verificación manual de `enable_signup=false` en el Supabase de producción como condición de go-live.

## 3. Fuera de alcance

- No se rediseña el flujo de checkout ni el widget de pago de OnvoPay.
- No se introduce un sistema de tokens de un solo uso para la página de éxito (se elige enmascarar el email server-side, sin nueva infraestructura de tokens — ver sección 5).
- No se redacta el **contenido legal** del aviso de privacidad ni de los términos y condiciones: el sistema provee las páginas y los enlaces; el **texto definitivo es responsabilidad del cliente** (operador turístico). Las páginas se entregan con contenido placeholder claramente marcado.
- No se resuelven hallazgos de severidad menor de la auditoría (P2/P3), incluyendo ACCESS-03 (la página `/checkout/cancel` libera un hold por id crudo), ACCESS-02 (rol en middleware), PRIV-02/03 (anonimización y cleanup de tokens), APPSEC-01/02, etc. Cada uno se atenderá en su propio spec.
- No se cambia el comportamiento de confirmación de pago, refunds ni reconciliación.
- No se construye un histórico de versiones del aviso de privacidad ni una UI para gestionarlas, ni se hace backfill de consentimiento a reservas previas: se guarda la versión vigente al momento de cada consentimiento como string (ver sección 6).

## 4. Historias de usuario

> Como turista que acaba de pagar, quiero ver la confirmación de mi reserva sin que mis datos personales queden expuestos en una URL compartible, para que nadie con el enlace pueda ver mi nombre ni mi correo completo.

Criterios de aceptación:

- [ ] La página `/[locale]/checkout/success` NO renderiza `customer_name` ni el `customer_email` completo.
- [ ] La página muestra el email **enmascarado** (p. ej. `j***@dominio.com`); el email completo nunca llega al HTML servido al cliente.
- [ ] La consulta de la página de éxito no selecciona `customer_name`; selecciona `customer_email` solo para enmascararlo server-side antes de renderizar.
- [ ] La página sigue mostrando el código corto de la reserva, el nombre del tour y la fecha/hora.
- [ ] La página indica que la confirmación se envió al correo del turista, acompañando el email enmascarado.

> Como turista, quiero aceptar explícitamente el tratamiento de mis datos y los términos antes de pagar, para saber cómo se usan mis datos y dar mi consentimiento informado.

Criterios de aceptación:

- [ ] El formulario de checkout incluye un checkbox de consentimiento obligatorio, con enlaces al aviso de privacidad y a los términos y condiciones (abren en una pestaña nueva).
- [ ] El atributo nativo `required` del checkbox impide enviar el formulario sin marcarlo (validación en cliente), y la server action **rechaza** la reserva si el consentimiento no llega, antes de consumir rate-limit o crear inventario (validación server-side, sin confiar solo en el cliente).
- [ ] Cuando el turista consiente, la reserva creada registra la fecha/hora en `bookings.consent_at` y la versión vigente del aviso en `bookings.consent_version`.
- [ ] Si el consentimiento no llega a la server action, no se crea hold, ni booking, ni payment intent, y se muestra un error.
- [ ] Existen las rutas públicas `/[locale]/privacy` y `/[locale]/terms`, en ES y EN, enlazadas desde el checkout.

## 5. Diseño técnico

### P1-1 — Enmascarar PII en la página de éxito

`web/app/[locale]/(public)/checkout/success/page.tsx` deja de seleccionar y renderizar `customer_name`, y deja de renderizar el `customer_email` completo. La consulta a `bookings` pasa a seleccionar `id, customer_email, tour_instance_id, status` (se conserva `customer_email` **solo** para enmascararlo server-side; se quita `customer_name`). Se reemplazan los dos `<p>` de nombre/email por un único bloque que muestra el email **enmascarado** con la clave i18n `success-email-sent` ("Te enviamos la confirmación a:") seguida del valor enmascarado. La clave i18n `success-name` queda huérfana y se **elimina** de `es.json` y `en.json`; `success-email` se reutiliza/ajusta para el nuevo texto (o se elimina si se usa solo `success-email-sent`).

**Enmascarado** (helper puro, p. ej. `web/lib/format/mask-email.ts`, con su test unitario): toma `local@dominio` y devuelve la primera letra del `local` + `***` + `@dominio`. Ej.: `juan.perez@gmail.com` → `j***@gmail.com`. Casos borde: `local` de 1 carácter → `j***@…`; entrada sin `@` o vacía → cadena vacía (no se renderiza el bloque). El email completo se lee server-side pero **nunca** se serializa al HTML: solo el resultado enmascarado.

**Decisión de diseño (alternativas consideradas):** el auditor propuso (a) token efímero de un solo uso, (b) reutilizar el `booking_access_token`, (c) no renderizar PII. Se descartan (a)/(b): (a) agrega un ciclo de vida de token nuevo; (b) es inviable porque el `booking_access_token` lo genera el worker al confirmar (webhook asíncrono), y al renderizar la página de éxito la reserva puede seguir en `pending_payment`, sin token aún. Sobre (c) vs. enmascarado: se elige **enmascarar** (decisión del usuario) como reaseguro visual para que el turista reconozca a qué correo llegó la confirmación, asumiendo que un atacante con el UUID vería solo el email parcial (primera letra + dominio), no el email completo ni el nombre. Es una reducción fuerte de la exposición, no su eliminación total; se acepta el residuo a cambio de la usabilidad.

No se toca `/[locale]/checkout/cancel` (su hallazgo ACCESS-03 es P3 y queda fuera de alcance); se verifica que esa página no renderiza PII (hoy no lo hace).

### P1-3 — Consentimiento en el checkout

**Formulario** (`web/components/public/CheckoutForm/CheckoutForm.tsx`): se agrega un checkbox `name="consent"` `required`, con label que contiene enlaces (`<a target="_blank" rel="noopener noreferrer">`) a `/[locale]/privacy` y `/[locale]/terms`. El botón de submit ya está deshabilitado mientras `pending`; la validación nativa `required` impide enviar sin marcar.

**Server action** (`web/lib/booking/checkout-action.ts`): se lee `formData.get('consent')`. Si no es `'on'` (o no está presente), la action retorna `{ error: 'error-generic' }` antes de tocar rate-limit, hold, booking o payment. Esto no confía en el `required` del cliente.

**Persistencia**: `initCheckout` (`web/lib/booking/create.ts`) recibe un nuevo parámetro `consentAccepted: boolean` y, al insertar el booking, setea `consent_at: new Date().toISOString()` y `consent_version: PRIVACY_NOTICE_VERSION`. El timestamp es la evidencia de consentimiento al momento de reservar; la versión traza **qué texto** del aviso aceptó el turista.

**Versión del aviso**: se define una constante `PRIVACY_NOTICE_VERSION` (string, p. ej. `'2026-06-12'`) en un módulo compartido (p. ej. `shared/constants/legal.ts`). La versión la **estampa el servidor** (no llega del cliente): el server conoce la versión vigente del aviso al momento del consentimiento. Cuando el cliente actualice el texto legal, se incrementa la constante, y las reservas nuevas registran la versión nueva sin afectar las previas.

**Páginas legales**: se crean `web/app/[locale]/(public)/privacy/page.tsx` y `web/app/[locale]/(public)/terms/page.tsx`, server components simples que renderizan contenido i18n placeholder, claramente marcado como pendiente de redacción por el cliente. Quedan bajo el grupo `(public)` (sin sesión). La constante `PRIVACY_NOTICE_VERSION` se documenta junto a estas páginas para que, al cambiar el texto, se actualice la versión.

### P1-2 — Verificación de signup en producción (no código)

No hay cambio de código. Se documenta en el plan de rollout (sección 11) y se confirma contra `docs/security-audits/GUIA-VERIFICACION-MANUAL.md §1 (Supabase)`. El flag ya está en `supabase/config.toml` y cubierto por `signup-disabled.test.ts`; lo que falta es confirmar el estado en el dashboard del proyecto hosted.

## 6. Modelo de datos

- **Tabla**: `bookings`
- **Acción**: alter
- **Columnas afectadas**:
  - `consent_at timestamptz NULL` — fecha/hora del consentimiento. Nullable, sin default.
  - `consent_version text NULL` — versión del aviso de privacidad aceptada (valor de `PRIVACY_NOTICE_VERSION` al momento de reservar). Nullable, sin default.
- **Índices**: ninguno nuevo.
- **Migración**: `supabase/migrations/20260612000033_add_booking_consent.sql`.

Ambas columnas se mantienen nullable a propósito: el consentimiento se exige en la capa de aplicación (server action) para reservas nuevas; no se impone `NOT NULL` para no romper las filas existentes (que quedan con ambas en `NULL`, sin backfill) ni acoplar la evidencia legal a un constraint de DB que complicaría migraciones de datos.

## 7. Estados y transiciones

No aplica. No se introducen ni modifican estados de `bookings`, `payments` ni `notifications`.

## 8. Casos borde y errores

- **Reserva sin consentimiento (cliente manipulado / request directa a la server action)**: la action valida `consent` server-side y retorna error genérico sin crear hold/booking/payment. Es el caso central de P1-3.
- **Página de éxito con `booking` inexistente o inválido**: comportamiento actual sin cambios (no se renderiza la tarjeta de reserva).
- **Página de éxito con `booking` de otra reserva (el escenario IDOR original)**: tras el cambio, un atacante con un UUID ve datos públicos del catálogo (tour, fecha), el código corto que ya tiene, y el email **enmascarado** (primera letra + dominio); nunca el nombre ni el email completo.
- **Email con formato inesperado al enmascarar** (sin `@`, vacío, local de 1 carácter): el helper devuelve cadena vacía y el bloque de email no se renderiza, en lugar de romper o filtrar el valor crudo.
- **Enlaces legales rotos antes de que el cliente redacte el contenido**: las páginas existen con placeholder, así que el enlace nunca apunta a 404.
- **i18n faltante**: todos los textos nuevos (checkbox, mensaje genérico de éxito, páginas legales) se agregan en ES y EN; un locale sin la clave mostraría la clave cruda, por eso se agregan ambos en el mismo PR.

## 9. Impacto en otras áreas

- **Panel admin**: sin cambios. (El export CSV ya incluye/excluye columnas según su propia lógica; `consent_at`/`consent_version` no se agregan a reportes en este spec.)
- **Emails / templates**: sin cambios.
- **Worker**: sin cambios.
- **Reportes / métricas**: sin cambios.
- **Pagos / refunds / cancelación**: sin cambios de comportamiento.
- **i18n**: textos nuevos a traducir (ES/EN): label de consentimiento con enlaces, `success-email-sent`, y el contenido placeholder de las páginas de privacidad y términos. Se elimina `success-name` (y `success-email` si queda sin uso).
- **Rutas nuevas**: `/[locale]/privacy` y `/[locale]/terms` (públicas).

## 10. Plan de tests

Según `testing-practices`:

- **Unit/integración (server action)**: `checkoutAction` rechaza la reserva cuando falta `consent` (request directa simulando cliente manipulado). El test afirma no solo que no se persiste booking, sino que `initCheckout` (y por ende `createHold`) **no se invoca** —vía spy/mock— para cubrir el caso de que la validación quede en el lugar equivocado de la cadena. Caso espejo: con `consent='on'` y datos válidos, `initCheckout` se invoca y procede.
- **Integración (persistencia)**: una reserva creada con consentimiento tiene `consent_at` no nulo (timestamp coherente con el momento de creación) y `consent_version` igual a `PRIVACY_NOTICE_VERSION`.
- **Unit (enmascarado)**: `maskEmail` cubre casos normales (`juan@gmail.com` → `j***@gmail.com`), local de 1 carácter, entrada sin `@`, dominio vacío, y cadena vacía → devuelve cadena vacía. Este test es la garantía automatizada de que el email completo no se serializa: la página solo renderiza `maskEmail(customer_email)` y no selecciona `customer_name`.
- **Página de éxito (verificación manual, no automatizada)**: el repo no tiene harness para renderizar server components async de Next (el entorno de vitest es `node`, sin DOM, y la página depende de `getTranslations`/`getLocale`/`createSupabaseServiceClient`); montar uno solo para este caso sería frágil. La ausencia de PII completa en el HTML se garantiza por construcción (no se selecciona `customer_name`; el email se enmascara con `maskEmail`, ya cubierto por unit test) y se valida con el test manual de abajo.
- **Test manual documentado en el PR**: recorrer el checkout, intentar enviar sin marcar el checkbox (bloqueado en cliente), completar el pago con tarjeta de prueba, y verificar en la página de éxito (vía devtools / ver código fuente) que no aparecen nombre ni email completo (solo el enmascarado).

## 11. Plan de rollout

- **No requiere feature flag.**
- **Migración de DB**: sí — `20260612000033_add_booking_consent.sql` (alter aditivo, no destructivo, sin migración de datos: las filas previas quedan con `consent_at`/`consent_version` en `NULL`).
- **Acción obligatoria antes del go-live (P1-2)**: el `enable_signup = false` ya está versionado en `supabase/config.toml`. Al provisionar el Supabase de **producción**, aplicarlo con `supabase config push` (tras `supabase link`) en vez de editar el dashboard a mano, para que el default del repo se aplique solo (el hook `custom_access_token_hook`, también en `config.toml` con `enabled = true`, viaja por el mismo push). Después confirmar en el dashboard que el auto-registro quedó OFF y el hook activo. Procedimiento detallado en `docs/security-audits/GUIA-VERIFICACION-MANUAL.md §1 (Supabase)`.
- **Contenido legal (cliente)**: el operador debe reemplazar el placeholder de `/privacy` y `/terms` con el texto definitivo y completar el registro ante PRODHAB si aplica, antes de operar con datos reales.
- **Reversibilidad**: los cambios de código son reversibles por revert del PR; la migración es aditiva y no requiere rollback de datos.

## 12. Métricas de éxito

- La página de éxito no expone el email completo ni el nombre: verificable en runtime con `curl`/devtools sobre una reserva propia (solo email enmascarado en el HTML).
- 100% de las reservas nuevas creadas tras el deploy tienen `consent_at` y `consent_version` no nulos.
- El ítem de verificación de `enable_signup=false` en producción queda marcado en la guía manual antes del go-live.

## 13. Preguntas abiertas

Ninguna. Las tres decisiones quedaron resueltas (2026-06-12):

- **Páginas legales**: rutas in-repo con contenido placeholder (`/privacy`, `/terms`) que el cliente completa.
- **PII en página de éxito**: se muestra el email **enmascarado** (`j***@dominio.com`); nunca el nombre ni el email completo.
- **Versión de consentimiento**: se guarda `consent_version` (versión vigente del aviso estampada server-side) además de `consent_at`.
