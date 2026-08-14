# Consulta a OnvoPay — cobro diferido con tarjeta retenida

- **Estado**: pendiente de enviar
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

**Canales**: WhatsApp de soporte (el más rápido según reseñas) · `notificaciones@onvopay.com` · `soporte.onvopay.com` · `/contact-us`.

## Verificaciones en sandbox (no dependen de la respuesta)

Se hacen en paralelo, contra `https://api.dev.onvopay.com/v1`, y valen como evidencia empírica aunque soporte no conteste:

- [ ] Guardar un método de pago con la publishable key **desde el navegador** y confirmar que el PAN no sale hacia nuestro backend (pestaña de red).
- [ ] Cobrar ese método varios días después y registrar el `status` devuelto (`succeeded` vs `requires_action`).
- [ ] Probar el rechazo con `4000000000000002` y anotar el `declineCode` exacto, que es lo que se persiste en `bookings.charge_last_error`.
- [ ] Llamar `POST /v1/payment-intents/{id}/cancel` sobre un intent en `requires_payment_method` y sobre uno ya `succeeded`; anotar códigos de respuesta.
- [ ] Confirmar dos veces el mismo intent y ver si OnvoPay lo rechaza o cobra dos veces.

## Dónde se aplica la respuesta

- **Pregunta 1 y 2** → definen si la métrica de ≥95% del spec 0029 §12 es alcanzable. Si la tasa de 3DS off-session resulta alta, hay que rediseñar: por ejemplo, autenticar al guardar la tarjeta, o aceptar que un porcentaje de reservas requiera acción del turista y ajustar los emails y la ventana de recuperación.
- **Pregunta 3** → fija el TTL máximo de una reserva sin cobrar (pregunta abierta Q3 del spec) y el horizonte de generación de salidas.
- **Preguntas 4 y 5** → habilitan o no la regla anti-doble-cobro del spec 0029 §5.6. Si no hay cancelación de intents, hay que reforzar el invariante por otro lado antes de aprobar el workstream C.
- **Pregunta 6** → alimenta la ampliación de `apply-retention` (spec 0022 + 0029 §6).
- **Pregunta 7** → si es afirmativa, se revisa §5.2 del spec 0029 y se evita el salto de SAQ A a SAQ A-EP.

Registrar las respuestas en [spec 0029 §13](specs/0029-cupo-minimo-y-cobro-diferido.md) y, si alguna cambia el diseño, actualizar el spec y pedir re-aprobación antes de implementar.
