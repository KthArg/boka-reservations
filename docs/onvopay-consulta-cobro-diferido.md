# Consulta a OnvoPay — cobro diferido con tarjeta retenida

- **Estado**: abierta. Se evaluó y descartó la autorización con captura (validez real ~7 días) y se volvió al cobro con tarjeta guardada (2026-09-13). Pendientes: prueba del CVV en sandbox y una pregunta a OnvoPay
- **Dueño**: Kenneth / cliente (titular de la cuenta OnvoPay)
- **Creado**: 2026-08-13
- **Relacionado**: [spec 0029 — Cupo mínimo y cobro diferido](specs/0029-cupo-minimo-y-cobro-diferido.md) §13 (Q1)

## Por qué existe este documento

El spec 0029 cambia el momento del cobro: el turista deja su tarjeta retenida al reservar y **el cargo se ejecuta después**, cuando la salida alcanza el mínimo de participantes — que puede ser semanas más tarde, con el turista fuera de la aplicación.

La documentación pública (`docs.onvopay.com/en/llms-full.txt`, revisada el 2026-08-13) confirma que las piezas existen: `POST /v1/payment-methods` tokeniza y adjunta la tarjeta a un `customer`, y `POST /v1/payment-intents/{id}/confirm` con `paymentMethodId` ejecuta el cobro desde el servidor. Lo que **no** dice es cómo se comporta ese cobro cuando el tarjetahabiente no está presente, que es exactamente nuestro caso.

Tres huecos concretos, todos con consecuencia de dinero:

1. **Sin flags de credencial almacenada (MIT / off-session)**, los emisores tratan el cargo como una transacción no autenticada y la tasa de rechazo puede ser materialmente más alta que en el cobro on-session que tenemos hoy. El spec fija como métrica de éxito ≥95% de cobros sin intervención manual; por debajo de eso, el modelo no cierra.
2. **Si el `paymentMethodId` caduca o deja de ser cobrable** pasadas unas semanas, el diseño entero se cae para reservas con anticipación, que son la mayoría.
3. **Si `POST /v1/payment-intents/{id}/cancel` no existe o no es confiable**, no podemos garantizar la regla anti-doble-cobro del spec (§5.6): cancelar el intent viejo antes de crear uno nuevo. Y un doble cobro **no se puede reparar automáticamente** con nuestro modelo de reembolsos, que admite un solo reembolso activo por reserva. Esta misma pregunta quedó abierta en el spec 0028 y sigue sin respuesta.

Ninguna de las tres se puede asumir sin confirmación (regla de `external-services-vetting`). Bloquean la aprobación del workstream C del spec 0029 (la automatización del cobro), no los workstreams A ni B.

## Preguntas a soporte de OnvoPay

1. **Cobro sin el cliente presente**: al confirmar un payment intent con `paymentMethodId` desde el servidor, sin que el tarjetahabiente esté en sesión, ¿marcan la transacción como _merchant-initiated_ / credencial almacenada ante la marca y el emisor? ¿Hay algún parámetro que debamos enviar para indicarlo?
2. **3DS en ese escenario**: ¿con qué frecuencia esperan `requires_action` en cobros off-session? ¿Existe forma de autenticar la tarjeta **al momento de guardarla** para que el cargo posterior no requiera autenticación?
3. **Vigencia del método de pago**: ¿por cuánto tiempo sigue siendo cobrable un `paymentMethodId` guardado? ¿Tienen actualización automática de tarjetas vencidas o renumeradas (_account updater_)?
4. **Cancelación de intents**: ¿existe `POST /v1/payment-intents/{id}/cancel`? ¿Sobre qué estados funciona (`requires_payment_method`, `requires_action`, `requires_confirmation`) y qué devuelve si el intent ya está en un estado terminal?
5. **Un intent por cobro**: si creamos un payment intent y no lo confirmamos nunca, ¿expira solo? ¿En cuánto tiempo?
6. **Baja de datos del cliente**: para cumplir con la Ley 8968 necesitamos poder eliminar la tarjeta y el cliente de sus sistemas a pedido del titular. ¿Cuáles son los endpoints para desvincular un método de pago y borrar un `customer`?
7. **Guardar tarjeta sin cobrar desde el SDK**: ¿el SDK embebido o el Checkout tienen algún modo _setup_ que permita guardar una tarjeta sin ejecutar un cargo? La documentación solo describe `paymentType: "one_time"` y `"subscription"`.

> Nota interna: la pregunta 7 **no bloquea**. Ya se decidió avanzar con formulario de tarjeta propio (tokenización client-side con la publishable key), asumiendo el alcance PCI SAQ A-EP. Si la respuesta fuera que sí existe un modo _setup_, nos permitiría volver a SAQ A y ahorrarnos esa exigencia de cumplimiento — por eso se pregunta, aunque no se espere para arrancar.

## Mensaje listo para enviar

> Hola, somos comercio de OnvoPay y estamos integrando un flujo donde guardamos el método de pago del cliente al momento de reservar y ejecutamos el cobro días o semanas después, sin que el cliente esté presente (cuando el tour alcanza su mínimo de participantes). Queremos confirmar varios puntos antes de implementarlo:
>
> 1. Al confirmar un payment intent con `paymentMethodId` desde nuestro servidor, sin el tarjetahabiente en sesión, ¿la transacción se marca como _merchant-initiated_ / credencial almacenada ante el emisor? ¿Hay algún parámetro que debamos enviar para indicarlo?
> 2. ¿Con qué frecuencia esperan que un cobro así devuelva `requires_action` por 3DS? ¿Se puede autenticar la tarjeta al guardarla para evitar la autenticación en el cargo posterior?
> 3. ¿Por cuánto tiempo sigue siendo cobrable un `paymentMethodId` guardado? ¿Tienen actualización automática de tarjetas vencidas o renumeradas?
> 4. ¿Existe un endpoint para cancelar un payment intent (`POST /v1/payment-intents/{id}/cancel`)? ¿Sobre qué estados funciona y qué devuelve si el intent ya es terminal?
> 5. Si creamos un payment intent y nunca lo confirmamos, ¿expira automáticamente? ¿En cuánto tiempo?
> 6. Para atender pedidos de eliminación de datos personales (Ley 8968), ¿qué endpoints usamos para desvincular un método de pago y eliminar un `customer`?
> 7. ¿El SDK embebido o el Checkout tienen algún modo que permita **guardar** una tarjeta sin ejecutar un cobro? En la documentación solo vemos `paymentType: "one_time"` y `"subscription"`.
>
> ¡Gracias!

**Canales** (verificados en `onvopay.com/contact-us`, 2026-08-13):

- `ayuda@onvopay.com` — soporte al cliente
- `ventas@onvopay.com` — ventas y nuevos servicios
- `rp@onvopay.com` — prensa
- WhatsApp **7019-6686** · portal `soporte.onvopay.com`

Corrección: una versión previa de este documento anotaba `notificaciones@onvopay.com`, que **no** figura como canal de contacto y por el nombre parece una casilla de envío automático. No usarla.

**Cuál usar para esta consulta**: `ayuda@onvopay.com`, referenciando el ticket del chat. Vale la pena copiar a `ventas@onvopay.com`: parte de lo que preguntamos es si la capacidad existe y si requiere habilitación contractual en la cuenta de comercio, que es tema comercial y no de soporte — y ventas suele tener más incentivo y mejor acceso para hacer que alguien conteste. El correo además deja constancia escrita, que el chat no.

## Verificaciones en sandbox (no dependen de la respuesta)

Se hacen en paralelo, contra `https://api.dev.onvopay.com/v1`, y valen como evidencia empírica aunque soporte no conteste:

- [ ] Guardar un método de pago con la publishable key **desde el navegador** y confirmar que el PAN no sale hacia nuestro backend (pestaña de red).
- [ ] Cobrar ese método varios días después y registrar el `status` devuelto (`succeeded` vs `requires_action`).
- [ ] Probar el rechazo con `4000000000000002` y anotar el `declineCode` exacto, que es lo que se persiste en `bookings.charge_last_error`.
- [ ] **(decisiva)** Llamar `POST /v1/payment-intents/{id}/cancel` sobre un intent en **`requires_action`** — soporte no lo incluyó entre los estados cancelables y de esto depende la regla anti-doble-cobro. Probar también sobre `requires_payment_method` y sobre uno ya `succeeded`; anotar códigos de respuesta.
- [ ] Confirmar dos veces el mismo intent y ver si OnvoPay lo rechaza o cobra dos veces.
- [ ] **(decisiva)** Confirmar un intent con un método de pago guardado **sin enviar `cvv`**, días después de haberlo creado. Si OnvoPay lo exige, el cobro diferido no es viable tal como está diseñado: guardar el CVV está prohibido por PCI.
- [ ] Tras un rechazo, re-confirmar **el mismo** intent con otro método de pago y verificar que funciona, como indica la documentación.
- [ ] Autorizar con `captureMethod: "manual"` y dejarlo sin capturar: registrar si la retención se libera antes de los 30 días que documenta OnvoPay.
- [ ] Cancelar un intent en `requires_capture` y verificar que libera la retención (base de la alternativa Q6 del spec).

## Dónde se aplica la respuesta

- **Pregunta 1 y 2** → definen si la métrica de ≥95% del spec 0029 §12 es alcanzable. Si la tasa de 3DS off-session resulta alta, hay que rediseñar: por ejemplo, autenticar al guardar la tarjeta, o aceptar que un porcentaje de reservas requiera acción del turista y ajustar los emails y la ventana de recuperación.
- **Pregunta 3** → fija el TTL máximo de una reserva sin cobrar (pregunta abierta Q3 del spec) y el horizonte de generación de salidas.
- **Preguntas 4 y 5** → habilitan o no la regla anti-doble-cobro del spec 0029 §5.6. Si no hay cancelación de intents, hay que reforzar el invariante por otro lado antes de aprobar el workstream C.
- **Pregunta 6** → alimenta la ampliación de `apply-retention` (spec 0022 + 0029 §6).
- **Pregunta 7** → si es afirmativa, se revisa §5.2 del spec 0029 y se evita el salto de SAQ A a SAQ A-EP.

Registrar las respuestas en [spec 0029 §13](specs/0029-cupo-minimo-y-cobro-diferido.md) y, si alguna cambia el diseño, actualizar el spec y pedir re-aprobación antes de implementar.

## Respuestas recibidas (2026-08-13) — primer nivel de soporte

Respondió un asistente que busca sobre la documentación, no una persona del equipo técnico. Salvo un punto, todas las respuestas fueron "no aparece información en los resultados", que **no equivale a una respuesta**: no confirma ni descarta nada. Se registran igual porque acotan qué está y qué no está documentado públicamente.

| #   | Tema                                                              | Respuesta                                                                                                                             | Sirve?                    |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | MIT / credencial almacenada                                       | Sin información                                                                                                                       | No                        |
| 2   | 3DS en cobros off-session y autenticación al guardar              | Sin información                                                                                                                       | No                        |
| 3   | Vigencia del `paymentMethodId` y account updater                  | Sin información                                                                                                                       | No                        |
| 4   | Cancelación de intents                                            | **Existe**; aplica sobre `requires_payment_method` y `requires_capture`. Sobre estados terminales (`succeeded`, `canceled`) no aplica | Parcial — ver abajo       |
| 5   | Expiración de intents no confirmados                              | Sin información                                                                                                                       | No                        |
| 6   | Baja de datos personales (detach de tarjeta, borrado de customer) | Sin información                                                                                                                       | No                        |
| 7   | Modo "guardar tarjeta sin cobrar" en SDK/Checkout                 | No documentado; solo `one_time` y `subscription`                                                                                      | Sí (confirma el supuesto) |

Ofrecieron derivar a un agente del equipo técnico/compliance para tratar MIT, 3DS off-session, retención de tokens y privacidad. **Hay que aceptar esa derivación**: son justamente los temas que bloquean el workstream C.

### La respuesta 4 abre un problema, no lo cierra

Los estados que enumeran son `requires_payment_method` y `requires_capture`. **No mencionan `requires_action`**, que es el estado en el que queda un intent esperando 3DS — y es exactamente el caso donde el spec necesita cancelar (§5.6, §5.7): si el turista abandona la autenticación y luego la completa tarde, un intent nuevo creado mientras tanto produce un doble cobro que nuestro modelo de reembolsos **no puede reparar** (un solo refund activo por reserva).

No se puede concluir que sea imposible: la respuesta viene de un bot que enumeró lo que encontró, no una negación explícita. Pero tampoco se puede asumir que funciona. Queda como el punto a confirmar con prioridad, por las dos vías (agente técnico y prueba en sandbox). Mientras tanto, el spec adopta la regla de contingencia de §5.7: con un intent vivo en `requires_action`, la reserva no genera intents nuevos; si la ventana vence sin autenticación, se cancela en vez de reintentarse.

La respuesta 7 sí es útil en sentido negativo: confirma que no hay modo _setup_ documentado, lo que respalda la decisión ya tomada de usar formulario propio y asumir SAQ A-EP.

## Seguimiento pendiente — escalar a técnico/compliance

Aceptar la derivación ofrecida y pedir respuesta explícita, por escrito, a estos puntos. Vale la pena aclararles que un "no está documentado" no nos sirve: necesitamos un sí o un no del equipo.

> Gracias. Sí, por favor conectame con el equipo técnico/compliance. Necesitamos respuestas explícitas (sí/no), no solo lo que esté documentado, porque de esto depende el diseño de un cobro que ejecutamos sin el cliente presente:
>
> 1. **Cancelación en 3DS**: ¿se puede cancelar un payment intent que está en `requires_action` (esperando autenticación 3DS)? Es el punto más importante para nosotros. Si no se puede, ¿qué le pasa a ese intent si el cliente nunca autentica: expira, y en cuánto tiempo?
> 2. **Doble confirmación**: si confirmamos dos veces el mismo payment intent, o confirmamos uno que el cliente ya autenticó por su cuenta, ¿lo rechazan o se generan dos cargos?
> 3. **Credencial almacenada**: ¿marcan estos cobros como _merchant-initiated_ ante el emisor? Si no lo hacen hoy, ¿está en el roadmap? Queremos entender qué tasa de rechazo esperar frente a un cobro con el cliente presente.
> 4. **3DS off-session**: ¿qué proporción de estos cobros esperan que devuelva `requires_action`? ¿Se puede autenticar la tarjeta al guardarla para evitarlo después?
> 5. **Vigencia del token**: ¿por cuánto tiempo sigue siendo cobrable un `paymentMethodId`? ¿Actualizan automáticamente tarjetas vencidas o renumeradas?
> 6. **Privacidad (Ley 8968)**: ¿qué endpoints usamos para desvincular un método de pago y eliminar un `customer` a pedido del titular? ¿Cuánto tiempo retienen ustedes esos datos?
> 7. **Contrato**: ¿guardar la tarjeta del cliente para cobrarle después requiere alguna habilitación o acuerdo adicional en nuestra cuenta de comercio?

Si el equipo técnico tampoco puede confirmar el punto 1, la verificación en sandbox pasa a ser la única evidencia y **debe hacerse antes de aprobar el workstream C**.

## Aprendizaje sobre cómo consultar a OnvoPay (2026-08-13)

La escalada llegó a una agente de soporte (Priscilla Rodríguez), cuya primera reacción fue que **siete preguntas técnicas juntas causan confusión** y pidió que le explicáramos el problema de fondo antes que los detalles.

Es una corrección válida y cambia el método para futuras consultas a este proveedor:

- **Soporte no es ingeniería.** Nombrar endpoints, estados de un intent o parámetros de API no ayuda; lo que destraba la conversación es el caso de negocio en lenguaje llano.
- **Una pregunta por vez**, y encadenada: la siguiente solo tiene sentido si la anterior dio verde.
- **Primero la pregunta que puede matar el diseño.** Si no soportan cobro con credencial almacenada, las otras seis son irrelevantes y el spec 0029 se cae entero.

Orden acordado para esta conversación:

1. ¿Soportan cobrar después, sin el cliente presente, con la tarjeta guardada? ¿Requiere habilitación en la cuenta de comercio? **← planteada**
2. ¿Qué pasa si ese cobro pide 3DS y el cliente no está para autenticar? (de acá sale lo de `requires_action`)
3. ¿Cuánto tiempo sigue siendo cobrable la tarjeta guardada?
4. Baja de datos del titular (Ley 8968).

Las preguntas 1 y 2 de esta lista son las que bloquean el workstream C. Las de detalle técnico (cancelación de intents en cada estado, doble confirmación, expiración) probablemente se resuelvan antes por **verificación en sandbox** que por soporte — mantener esa vía como la principal.

## Respuesta por correo (2026-09-12)

`ayuda@onvopay.com` respondió:

> Si puedes hacerlo por lo onvo loop puedes ver mas información acá, pero si puedes hacer pagos recurrentes por el tiempo que elijas con el cliente. https://docs.onvopay.com/

Tampoco resuelve la consulta. Responde sobre **cobros recurrentes** (suscripciones), que no es nuestro caso: necesitamos **un solo cobro**, en un momento que no conocemos de antemano. "Onvo Loop" **no aparece ni una vez** en la documentación; probablemente sea el nombre comercial de las suscripciones. Lo único aprovechable fue la remisión a la documentación, que resultó ser donde estaban las respuestas.

## Lo que resuelve la documentación oficial (2026-09-12)

Tres rondas de soporte no respondieron lo que la especificación publicada responde directamente. Fuentes: `https://docs.onvopay.com/openapi.yaml` (contrato de la API, fuente de verdad) y `https://docs.onvopay.com/en/llms-full.txt` (guías).

| Pregunta                                                    | Qué dice la documentación                                                                                                                                                                                                                                                                                          | Estado                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1. ¿Cobran una tarjeta guardada sin el cliente presente?    | Sí, es una capacidad de primera clase: las suscripciones "crean un payment intent para ese período y lo confirman con el método de pago" en cada renovación. Para un cobro único el flujo documentado es el mismo: crear el intent y confirmarlo con `paymentMethodId` desde el servidor.                          | **Resuelta**                                                 |
| 1b. ¿Hay parámetro para declarar el cobro como off-session? | **No.** `ConfirmPaymentIntent` acepta solo `paymentMethodId`, `cvv`, `credixInstallmentMonths` y `returnUrl`. `setupFutureUsage` existe, pero únicamente al confirmar una sesión de Checkout. Si ONVO marca estos cobros ante el emisor, no está expuesto.                                                         | **Resuelta** (en negativo)                                   |
| 2. 3DS sin el cliente presente                              | `requires_action` con `nextAction.redirectToUrl`, o `onvo.handleNextAction({ paymentIntentId })` con su librería web (`https://js.onvopay.com/v1/`). Permite que el turista complete el 3DS desde un enlace a **nuestro** sitio. La frecuencia esperada no está documentada.                                       | Parcial — la frecuencia solo se mide en sandbox o producción |
| 3. Vigencia de la tarjeta guardada                          | No documentada. Sí se exponen `card.expMonth` y `card.expYear`: se puede detectar **al reservar** una tarjeta que vence antes de la fecha del tour.                                                                                                                                                                | Abierta                                                      |
| 4. Cancelación de intents                                   | `POST /v1/payment-intents/{id}/cancel` existe, pero **no documenta** sobre qué estados funciona. La lista que dio el bot de soporte (`requires_payment_method`, `requires_capture`) no figura en la especificación.                                                                                                | Abierta — sandbox                                            |
| 4b. Reintentar tras un rechazo                              | Un intent rechazado **permanece** en `requires_payment_method` y se re-confirma "indicando uno diferente". OnvoPay recomienda "exactamente un intent por pago".                                                                                                                                                    | **Resuelta** — simplifica §5.6 del spec                      |
| 5. Expiración de intents no confirmados                     | No documentada.                                                                                                                                                                                                                                                                                                    | Abierta                                                      |
| 6. Baja de datos (Ley 8968)                                 | `POST /v1/payment-methods/{id}/detach`: el estado `detached` es **irreversible** y el método no se puede reutilizar. `DELETE /v1/customers/{id}` existe, sin documentar si desvincula los métodos de pago, así que hay que hacer `detach` explícito antes. El bot de soporte dijo que estos endpoints no existían. | **Resuelta**                                                 |
| 7. Guardar tarjeta sin cobrar desde SDK o Checkout          | El SDK solo documenta `paymentType: "one_time"` y `"subscription"`. "Verify a Payment Method" es para cuentas bancarias (IBAN), no para tarjetas.                                                                                                                                                                  | **Resuelta** (no existe)                                     |

### Riesgo nuevo: CVV al confirmar

Al crear el método de pago el `cvv` es **opcional** ("si lo enviás, debe contener 3 o 4 dígitos"). Pero `ConfirmPaymentIntent` también acepta `cvv`, y lo describe así: _"ONVO lo usa cuando el método de pago requiere confirmación con CVV"_. Si una tarjeta guardada lo exigiera al cobrar, el cobro diferido **no se podría hacer**, porque guardar el CVV está prohibido por PCI. Es la prueba de sandbox más importante junto con la cancelación en `requires_action`.

### Hallazgo que reabre el diseño: la captura manual retiene hasta 30 días

El spec 0029 descartó autorizar al reservar y capturar después apoyándose en dos premisas. **Ninguna se sostiene**:

1. _"Solo disponible en integraciones 100% API, no con el SDK embebido."_ Cierto, pero al pasar a formulario propio con tokenización client-side, decisión ya tomada en §5.2, **nuestra integración es 100% API**.
2. _"Una autorización expira en días."_ El esquema de `captureMethod` dice: _"Si no se completa la captura en un máximo de 30 días, los fondos serán liberados de vuelta al cliente."_

Queda registrado como pregunta Q6 del spec: es una decisión de diseño con consecuencias de producto, no un ajuste de implementación.

## Decisión (2026-09-13)

Se evaluó y **se descartó** autorizar al reservar y capturar al alcanzar el mínimo:

- El OpenAPI de OnvoPay dice que la captura manual libera los fondos si no se captura "en un máximo de 30 días", pero ese es el plazo de **su sistema**, no de la marca. Las marcas fijan la validez de una autorización online en **unos 7 días**. Los 30 días corresponden a una **autorización extendida**, que el procesador tiene que pedir explícitamente (la API de OnvoPay no lo expone), restringida a rubros como hotelería, alquiler de autos y cruceros, y pensada para cuando no se conoce el monto final. Fuentes: documentación de Stripe sobre autorización extendida y cambios al marco de autorización de Visa (abril 2024).
- La guía de autorización y captura de OnvoPay no menciona los 30 días y pone como ejemplos hoteles y alquileres.
- Con unos 7 días de validez, y midiendo la retención hasta la fecha del tour (en modo manual nada obliga a decidir antes), el límite de anticipación de reserva quedaba en 5–6 días: comercialmente inviable.

Se **vuelve al diseño original**: tarjeta guardada y cobro cuando se alcanza el mínimo. Lo respaldan las suscripciones de OnvoPay: cada renovación es un payment intent nuevo que OnvoPay confirma con la tarjeta guardada, sin el cliente presente. La plataforma ya hace ese tipo de cobro como producto.

También se descartó modelar cada reserva como una suscripción con `paymentBehavior: "allow_incomplete"` para que el cobro lo hiciera el motor de suscripciones: presenta una compra única como recurrente ante la marca y, si la cancelación de la suscripción falla, genera un segundo cobro que el modelo de reembolsos no puede reparar.

**Pendiente para cerrar esta consulta:**

- **Prueba en sandbox (bloqueante):** confirmar un intent con una tarjeta guardada **sin enviar `cvv`**, días después de guardarla. Si OnvoPay lo exige, el cobro diferido no es viable, porque el CVV no se puede guardar.
- **Una sola pregunta a OnvoPay, por correo a ayuda@onvopay.com:**

  > Si guardamos la tarjeta del cliente al reservar y días después confirmamos un payment intent con ese `paymentMethodId` desde nuestro servidor, sin el cliente presente, ¿ONVO lo procesa igual que las renovaciones de sus cargos recurrentes?
