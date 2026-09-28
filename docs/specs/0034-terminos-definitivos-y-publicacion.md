# 0034 — Términos definitivos y publicación de los textos legales

- **Estado**: approved
- **Autor**: Claude (con decisiones del usuario del 2026-09-27)
- **Creado**: 2026-09-27
- **Última actualización**: 2026-09-27
- **Rama**: feat/0034-terminos-definitivos
- **PR**: (cuando aplique)

Aprobación: el usuario pidió el 2026-09-27 escribir los términos y adecuar la plataforma "en esta misma sesión", sin nada "por definir". Las decisiones de producto de este spec son suyas (sección 1); las que tomé yo están marcadas como tales en la sección 5. Revisado por spec-reviewer el mismo día; los hallazgos están resueltos en este texto.

## 1. Contexto y motivación

La abogada aprobó cuatro textos en septiembre de 2026 (PDF "Textos aprobados"): términos y condiciones, aviso de privacidad, textos del proceso de compra y un aviso en papel para el personal. Hoy producción muestra `[PENDIENTE]` en `/terms` y `/privacy`, y el PR #80 subió `TERMS_VERSION` a `2026-09-23` con un párrafo de retención que nadie aprobó.

El usuario decidió el 2026-09-27, sobre la base de esos textos:

- **Reembolsos completos.** Cuando corresponde reembolso, es siempre el 100 %. Nunca se descuenta la comisión de OnvoPay.
- **Sin derecho de retracto en los términos.** Se elimina la cláusula 6 aprobada. Con 24 horas o más de anticipación se devuelve el 100 %; con menos de 24 horas, o si no se presenta, no hay reembolso.
- **Aviso por mínimo de participantes: 24 horas.**
- **Tolerancia de llegada tarde: 15 minutos, editable desde el panel.**
- **Sin reembolso automático** si el guía impide participar por seguridad: decide el equipo caso por caso, entre el 100 % de la reserva o nada.
- **Clima, seguridad o fuerza mayor: sin reembolso automático.** El turista reserva bajo su propio riesgo; cada reserva pasa a revisión y el equipo decide entre reembolso del 100 %, cambio de fecha o ningún reembolso (spec 0035).
- **Quejas: 10 días hábiles.**
- **Sin doble factor**: se saca la frase del aviso de privacidad.
- **Planes**: Supabase Pro, Vercel Pro, Railway Hobby.
- **Solo los dos textos del sitio**, en español e inglés. El aviso en papel para el personal queda fuera.
- **Datos del operador** (razón social, cédula, domicilio, marca, correos, teléfono, horario, declaratoria del ICT, póliza): pendiente antes de producción.

Riesgo que el usuario conoce y asumió: según los PDFs de la abogada, el retracto de 8 días hábiles del reglamento de la Ley 7472 es un derecho legal que los términos no pueden quitar. Los términos no lo mencionan ni lo niegan, y conservan la cláusula aprobada "nada en ellos limita los derechos que la ley le reconoce como consumidor". Al quitar la cláusula 6 y cambiar la 7, el texto deja de ser exactamente el aprobado.

Este spec cubre los textos y todo lo que la plataforma tiene que mostrar para que sean ciertos. La operación nueva que prometen (cancelación por mínimo, cambio de fecha, devolución por transferencia) está en el spec 0035, y el tratamiento de datos que promete el aviso, en el 0036. Los tres se publican juntos.

## 2. Objetivos

- Publicar términos y aviso de privacidad definitivos, en español e inglés, sin corchetes ni condicionales: cada frase describe cómo funciona la plataforma.
- Guardar la identidad del operador en un solo lugar editable desde el panel y usarla en los textos, el pie del sitio, el pie de los correos y el resumen de compra.
- Impedir que alguien pague mientras falten datos del operador.
- Mostrar antes de pagar el resumen que los términos prometen: IVA desglosado, condiciones de cancelación, tolerancia de llegada y vendedor.
- Devolver siempre el 100 % cuando corresponde reembolso.

## 3. Fuera de alcance

- La facturación electrónica. Los términos prometen una factura por cada compra y la plataforma no la emite. Se integra con la API de Hacienda en el spec 0037; hasta entonces el operador la emite con la herramienta de Hacienda.
- La cancelación por mínimo, el cambio de fecha, la cancelación de una salida por el operador, el bloqueo del punto de encuentro y la devolución por transferencia (spec 0035).
- El borrado a los 5 años, las huellas con clave secreta y la pantalla de borrado a pedido (spec 0036).
- El cobro diferido: sigue apagado y los textos describen solo el cobro inmediato.
- La huella SHA-256 del texto aceptado: los textos no la prometen.
- Cargar los datos reales del operador (tarea de producción).

## 4. Historias de usuario

> Como turista, quiero leer, imprimir y volver a consultar los términos exactos que acepté, para saber qué me corresponde si cancelo.

- [ ] `/terms` y `/privacy` muestran la versión vigente, completa, en el idioma de la ruta, con un botón para imprimir y estilos de impresión.
- [ ] `/terms/<versión>` y `/privacy/<versión>` muestran siempre esa versión; una versión inexistente responde 404.
- [ ] El correo de confirmación enlaza la versión aceptada de cada texto.
- [ ] Ninguna página ni correo muestra corchetes, `[PENDIENTE]` ni texto condicional.

> Como turista, quiero ver antes de pagar el total con el IVA, las condiciones de cancelación y quién me vende, para decidir con toda la información.

- [ ] El resumen muestra tour, fecha y hora, punto de encuentro, tiquetes, "Total: USD X, IVA incluido (IVA: USD Y)", la regla de cancelación, la tolerancia de llegada tarde y "Vendido por {razón social}, cédula jurídica {número}".
- [ ] El IVA incluido es `round(total × 13 / 113)` en centavos: USD 6,90 en USD 60,00.
- [ ] Las casillas usan los textos aprobados y el error de casilla faltante dice "Para continuar, marcá las dos casillas".
- [ ] El botón dice "Pagar USD {monto}".

> Como operador, quiero cargar la identidad del negocio y la tolerancia de llegada desde el panel, para no depender de un deploy.

- [ ] Configuración tiene una sección "Datos del operador" editable solo por admin.
- [ ] Mientras falte un dato obligatorio, el checkout responde "La venta en línea todavía no está habilitada" y no crea holds ni intents; las páginas legales explican lo mismo en lugar del texto.
- [ ] Un tour sin "qué no incluye", sin requisitos o, si vende tiquete de niño, sin edades, no se puede reservar: la página del tour no ofrece el checkout y la acción lo rechaza.
- [ ] La tolerancia de llegada tarde se edita entre 0 y 120 minutos y cada reserva guarda el valor vigente al crearse.

> Como turista que cancela con anticipación, quiero recibir todo lo que pagué.

- [ ] Con 24 horas o más de anticipación el reembolso es el total; con menos, cero. El panel y la pantalla del turista muestran el monto antes de confirmar.
- [ ] Ningún reembolso descuenta comisión.

## 5. Diseño técnico

**Textos como componentes versionados.** Los textos no caben en una cadena del archivo de idiomas: tienen secciones, listas y datos del operador. Cada versión es un componente TSX por idioma bajo `web/content/legal/<texto>/<versión>/{es,en}.tsx`, que recibe la identidad del operador como props. Un registro `web/content/legal/registry.ts` mapea versión → componentes. `TERMS_VERSION` y `PRIVACY_NOTICE_VERSION` pasan a `2026-09-27`. Se descarta markdown porque sumaría una dependencia y un parser para cuatro documentos.

**Rutas.** `/[locale]/terms` y `/[locale]/terms/[version]`, igual para `privacy`. La vigente es la última del registro. Botón "Imprimir" con `window.print()` y hoja `@media print` que oculta cabecera y pie del sitio.

**Identidad del operador en `business_settings`** (decisión mía: el PDF de cambios ofrecía también variables de entorno, pero así el operador la carga sin deploy y el merge a `main` no rompe producción por una variable faltante). Columnas nuevas en la sección 6. `getOperatorIdentity()` en la web y `loadOperatorIdentity()` en el worker la leen con el service client. `isOperatorIdentityComplete()` exige razón social, cédula, domicilio, marca, correo de contacto, correo de privacidad, teléfono y horario; la declaratoria del ICT y la póliza son opcionales porque su frase solo aparece si existen.

**Compuerta de venta.** `checkoutAction` y `deferredCheckoutAction` verifican la identidad antes de crear el hold. El error es `CheckoutError.SalesNotEnabled`.

**Tolerancia de llegada.** `business_settings.no_show_tolerance_minutes` y `bookings.no_show_tolerance_minutes`. La copia un trigger `BEFORE INSERT` en `bookings`: la reserva del cobro inmediato se inserta desde `web/lib/booking/create.ts` y la del diferido desde `create_deferred_booking`, así que el trigger cubre los dos flujos sin cambiar firmas. Decisión mía: los términos no llevan el número, dicen "la tolerancia indicada en el resumen de compra y en su correo de confirmación". Si el número estuviera en el texto, cambiarlo desde el panel alteraría retroactivamente versiones ya aceptadas.

**IVA.** `VAT_RATE_PERCENT = 13` en `shared/constants/policies.ts`, verificado el 2026-09-27: es la tarifa general de la Ley 9635, que rige para servicios turísticos desde el 1 de julio de 2023, con o sin inscripción en el ICT, al terminar el transitorio de la Ley 9882 (fuentes: Periódico Mensaje, 29/06/2023; El Financiero; Sovos). `vatIncludedCents(total)` calcula el componente incluido. El worker no puede importar `@shared` en runtime, así que el correo de confirmación duplica la constante y el cálculo en `worker/src/notifications/templates/format.ts`, con un test que compara los dos resultados.

**Reembolso completo.** `computeRefund` queda con tres reglas: por decisión del operador, el total; a pedido del cliente con 24 horas o más, el total; con menos, nada. Se borran `computeProcessingFee`, las constantes de comisión e IVA retenido, `REFUND_FEE_FROM_TERMS_VERSION`, el aviso de comisión del checkout (`refund-fee-notice.ts`) y sus textos. La función SQL `cancel_booking` de 6 parámetros sigue recibiendo `p_fee_cents = 0`, y un CHECK nuevo (`refunds.processing_fee_cents = 0`) lo garantiza en la base, no solo en la app.

**Pie del sitio.** `layout.tsx` público: identidad del operador y enlaces a Términos, Aviso de privacidad y "Quejas y reclamos" (`/terms#quejas`). También en las páginas `/booking/[token]`.

**Pie de los correos.** `wrapHtml` deja un marcador `<!--legal-footer-->` en lugar de "Boka Verde"; `send-notifications` lo reemplaza antes de enviar con el pie aprobado en el idioma del correo (y agrega el texto plano). La identidad se lee una vez por ciclo. Los correos a guías llevan un pie sin la frase "hiciste una reserva". Si la identidad está incompleta al enviar (solo puede pasar con un correo a un guía, porque sin identidad no hay ventas), el pie lleva solo los enlaces legales. Decisión mía: reemplazar en un solo punto evita tocar las trece plantillas y que alguna quede sin pie.

**Cambios de identidad.** La acción de Configuración audita en `audit_logs` cada cambio de la identidad del operador con los valores anteriores y nuevos: cambian textos que los turistas ya aceptaron.

**Compuerta por tour.** `isTourBookable(tour)` exige "qué no incluye" y requisitos en los dos idiomas, y edades del tiquete de niño si el tour tiene precio de niño. La usan la página del tour (oculta el botón de reservar) y las acciones del checkout.

**Correo de confirmación.** Agrega el IVA incluido, "Con este enlace podés consultar o cancelar tu reserva. No lo compartas.", el resumen de cancelación, la tolerancia de la reserva y "Aceptaste los Términos y condiciones (versión X) y el Aviso de privacidad (versión Y)" con enlaces a las URLs versionadas.

**Página del tour.** Muestra "Qué no incluye", "Requisitos" y las edades del tiquete de niño. El formulario del panel los exige.

**Pantalla de cancelación.** Textos aprobados sin las variantes de retracto: con reembolso muestra el monto; con menos de 24 horas, "Faltan menos de 24 horas para el tour. Si cancelás ahora, no hay reembolso, según las condiciones de cancelación que aceptaste".

**Cambios respecto del texto aprobado** (el resto queda literal):

- T1: datos desde el panel; la frase del ICT solo si hay número.
- T4: "al pasar al pago, apartamos sus cupos por 15 minutos; si en ese plazo no inicia el pago, los cupos se liberan". Son 15 minutos, que es lo que hace `tour_holds`, no 20; y un hold `paying` no se libera a los 15 minutos, de ahí "no inicia".
- T5: IVA del 13 %.
- T6: eliminada.
- T7 pasa a ser la cláusula 6: 100 % con 24 horas o más, nada con menos o por no presentación, tolerancia según el resumen y el correo.
- T8 (ahora cláusula 7): aviso por mínimo con 24 horas; clima, seguridad y fuerza mayor se reservan bajo el riesgo del turista y cada reserva pasa a revisión (reembolso del 100 %, cambio de fecha o ningún reembolso); no se cambian fecha, hora ni punto de encuentro de una salida con reservas; cualquier otra cancelación, 100 % (spec 0035).
- T9: el reembolso se procesa al confirmarse la cancelación; se quita "dentro de los mismos plazos", que remitía al retracto.
- T10 (ahora cláusula 9): "no hay reembolso automático; revisamos el caso y le comunicamos por correo nuestra decisión, que puede ser el reembolso del 100 % de la reserva o ningún reembolso". El reembolso parcial no existe (contrato de `cancel_booking`).
- T11: la póliza solo si existe.
- P4: OnvoPay guarda los datos en "bases de datos propias de ONVO Costa Rica S.A. en Amazon Web Services", que es lo que declaran su política de privacidad (onvopay.com/CR/documents/politica-de-privacidad.pdf) y su sitio. Supabase está en West US (Oregón), verificado con `supabase projects list`. Railway, Resend y Sentry se configuran en región de Estados Unidos (checklist de lanzamiento).
- P2: registros técnicos de un máximo de 30 días. Con los planes elegidos, verificado el 2026-09-27 en la documentación de cada proveedor: Vercel Pro 1 día (vercel.com/docs/logs/runtime), Railway Hobby 7 (docs.railway.com/observability/logs), Supabase Pro 7 (supabase.com/pricing), Resend 30 en todos sus planes (resend.com/docs/knowledge-base/account-quotas-and-limits) y Sentry Developer 30 (docs.sentry.io). Sentry Team guarda 90: el checklist exige el plan Developer.
- P2 suma la frase de los datos de cuenta para devoluciones por transferencia (spec 0036).
- P6: respaldos de 7 días (Supabase Pro).
- P8: sin doble factor.

## 6. Modelo de datos

- **Tabla** `business_settings` — alter. Columnas nuevas, todas `text NOT NULL DEFAULT ''` salvo indicación: `operator_legal_name`, `operator_tax_id`, `operator_address`, `operator_brand`, `operator_contact_email`, `operator_privacy_email`, `operator_phone`, `operator_hours`, `operator_ict_declaration` (vacío = no tiene), `operator_has_liability_policy boolean NOT NULL DEFAULT false`, `no_show_tolerance_minutes integer NOT NULL DEFAULT 15` con CHECK `BETWEEN 0 AND 120`. `GRANT UPDATE` de columna a `authenticated`, como las existentes; la acción valida el rol admin.
- **Tabla** `bookings` — alter: `no_show_tolerance_minutes integer NULL`. Nulo en reservas anteriores.
- **Tabla** `tours` — alter: `excludes_es`, `excludes_en`, `requirements_es`, `requirements_en` (`text NOT NULL DEFAULT ''`), `child_age_min`, `child_age_max` (`integer NULL`, CHECK `child_age_min <= child_age_max`).
- **Tabla** `refunds` — alter: CHECK `refunds_no_processing_fee_check` (`processing_fee_cents = 0`). Producción no tiene filas con comisión: la política del spec 0032 nunca se activó.
- **Trigger** `bookings_set_no_show_tolerance` (`BEFORE INSERT`): copia la tolerancia vigente si la fila no la trae.
- **Migración**: `supabase/migrations/20260927000048_terminos_definitivos.sql`.

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Identidad incompleta**: el checkout no se abre y las páginas legales dicen que la venta no está habilitada. Nunca se muestra un texto con datos vacíos.
- **Se editan los datos del operador después de publicar**: las versiones ya publicadas muestran los datos actuales. La identidad no es una condición contractual y no genera versión nueva.
- **Se cambia la tolerancia**: las reservas existentes conservan la suya; el correo y la pantalla de la reserva leen la de la reserva.
- **Reserva previa a esta versión** (`terms_version` viejo o `[PENDIENTE]`): se rige igual por la regla de 24 horas, que no cambió.
- **Versión inexistente en la URL**: 404.

## 9. Impacto en otras áreas

- Panel: sección "Datos del operador" y tolerancia en Configuración; campos nuevos en el formulario de tours.
- Correos: pie en todos y parte legal en la confirmación.
- Reportes: sin cambios (`processing_fee_cents` queda siempre en 0).
- i18n: textos nuevos en `es.json` y `en.json`.
- `docs/lanzamiento-checklist.md`: requisitos para abrir la venta: datos del operador cargados; worker corriendo con `NOTIFICATIONS_ENABLED=true` y `RETENTION_ENABLED=true`; Supabase Pro (respaldos de 7 días); Sentry en plan Developer; Railway, Resend y Sentry en región de Estados Unidos; proceso de factura electrónica por venta (spec 0037); `IDENTIFIER_HASH_SECRET` en Vercel (spec 0036).
- `.claude/memory/decisions.md`: entrada del 2026-09-27 que reemplaza la del 2026-09-21 (reembolso sin comisión) y registra el abandono del retracto y los planes.

## 10. Plan de tests

- Unitarios: `computeRefund` (borde exacto de 24 h, operador, cliente), `vatIncludedCents` (60,00 → 6,90; redondeo), `isOperatorIdentityComplete`, `isTourBookable`, registro de versiones (la vigente es la última y coincide con `TERMS_VERSION` y `PRIVACY_NOTICE_VERSION`), pie del correo por idioma y por destinatario.
- Unitario de contenido: cada versión de cada texto, en los dos idiomas, y cada plantilla de correo, renderizadas con una identidad completa, no contienen `[`, `{`, `}` ni `PENDIENTE`.
- Integración: checkout bloqueado sin identidad; checkout abierto con identidad; la reserva copia la tolerancia; permisos de columna de `business_settings` (staff no la edita).
- Manual: `/terms`, `/terms/2026-09-27`, impresión, pie del sitio y resumen de compra.

## 11. Plan de rollout

- Sin feature flag. La compuerta de identidad protege producción: al desplegar, la venta queda cerrada hasta que el admin cargue los datos del operador.
- Migración aditiva, antes del código.
- Reversible: revertir el código; las columnas nuevas no afectan a la versión anterior.

## 12. Métricas de éxito

- El test de contenido pasa en CI para toda versión publicada y toda plantilla.
- Toda reserva creada desde la publicación guarda `terms_version` igual a la versión vigente y su tolerancia.

## 13. Preguntas abiertas

Ninguna. Los datos del operador son una tarea de producción, no una decisión de diseño.
