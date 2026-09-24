# Consulta a OnvoPay — comisiones en reembolsos

- **Estado**: respondida parcialmente el 2026-09-23 (falta la tabla de comisiones de la cuenta)
- **Dueño**: Kenneth / cliente (titular de la cuenta OnvoPay)
- **Creado**: 2026-06-02
- **Relacionado**: [spec 0011 — Cancelaciones con refund automático](specs/0011-cancelaciones-refund-automatico.md) §13 (preguntas abiertas)

## Por qué existe este documento

El spec 0011 implementa reembolsos automáticos contra OnvoPay. La **política de reembolso al cliente** ya está resuelta en código (binaria 24h, parametrizable en `shared/constants/policies.ts → computeRefund`). Lo que **no** se pudo confirmar desde fuentes públicas es **el costo para el comercio**: si OnvoPay devuelve o retiene su comisión cuando se hace un reembolso.

Se buscó en: docs de la API (`docs.onvopay.com`), página de precios, `/policies`, el centro de ayuda (`soporte.onvopay.com`) y el plugin oficial de WooCommerce. Ninguno lo aclara. La fuente confiable es el **contrato de comercio / T&C** (que la web no expone por URL directa) o **preguntar a OnvoPay**. No se debe asumir un número sin confirmación (regla de `external-services-vetting`).

Este dato **no bloquea** la feature: `computeRefund` reembolsa al cliente el 100% de lo que pagó; la comisión es economía del comercio. Solo afecta la definición comercial de "reembolso total" y la proyección de costos.

## Preguntas a responder

1. **Comisión en reembolso total**: cuando el comercio reembolsa el 100% de una transacción exitosa, ¿OnvoPay devuelve al comercio la comisión que cobró por el cobro original, o la retiene (el comercio la absorbe)?
2. **Comisión en reembolso parcial**: si el reembolso es parcial, ¿la comisión se prorratea, se retiene completa, o se devuelve la parte proporcional?
3. **Costo adicional por reembolsar**: ¿reembolsar tiene algún cargo extra propio (distinto de la comisión del cobro original)?
4. **Plazo de acreditación**: ¿cuánto tarda en acreditarse un reembolso al cliente (tarjeta y SINPE Móvil)?
5. **Ventana**: ¿hay un plazo máximo desde el cobro para poder reembolsar? ¿Cambia algo si el cobro ya fue liquidado al comercio?

## Mensaje listo para enviar

> Hola, somos comercio de OnvoPay y estamos integrando reembolsos vía la API (`POST /v1/refunds`). Necesitamos confirmar el tratamiento de la comisión:
>
> 1. Cuando reembolsamos el total de una transacción exitosa, ¿nos devuelven la comisión cobrada en el cobro original o queda retenida?
> 2. En un reembolso parcial, ¿cómo se calcula la comisión (se prorratea, se retiene, se devuelve proporcional)?
> 3. ¿Reembolsar tiene algún cargo adicional propio?
> 4. ¿En cuánto tiempo se acredita el reembolso al cliente (tarjeta y SINPE Móvil)?
> 5. ¿Hay un plazo máximo desde el cobro para poder reembolsar, o alguna diferencia si ya se liquidó el dinero al comercio?
>
> ¡Gracias!

**Canales**: WhatsApp de soporte (el más rápido según reseñas) · `notificaciones@onvopay.com` · `soporte.onvopay.com` · `/contact-us`.

## Dónde se aplica la respuesta

- Si OnvoPay **retiene** la comisión: el comercio asume el ~3.9%+$0.25 (tarjeta) de cada reembolso. Es decisión comercial si "reembolso total" sigue siendo el 100% al cliente (lo más probable y lo que hoy hace el código) o si la política pasa a "total menos comisión" → en ese caso, ajustar **solo** `computeRefund`.
- Registrar la respuesta en [spec 0011 §13](specs/0011-cancelaciones-refund-automatico.md) y, si define la política definitiva, actualizar `computeRefund` con su razón.

## Respuesta de OnvoPay (soporte, 2026-09-23)

1. **La comisión NO vuelve al reembolsar.** Con un reembolso al 100 %, al cliente se le devuelve el monto
   completo del cargo, pero la comisión y su retención de IVA "no se revierten íntegramente al comercio en
   la liquidación": son costo de procesamiento. Confirma el supuesto del spec 0032.
2. **No hay comisión propia por reembolsar.** En la configuración de la cuenta no aparece un cargo
   dedicado al acto de reembolsar, solo las comisiones normales del cobro y su retención de IVA.
3. **La tarifa real de la cuenta NO es 3,9 % + US$0,35.** Dicen que la comisión de tarjeta es la suma de
   varios componentes (porcentajes y montos fijos) y que además hay una **retención de IVA del 0,777 %
   sobre la comisión**. Ofrecieron mostrar la tabla exacta de la cuenta: **es lo que falta pedir**, y de
   ahí salen los valores de `PROCESSING_FEE_PERCENT_BPS` y `PROCESSING_FEE_FIXED_CENTS`.
4. **Reembolso parcial**: la comisión se cobra sobre el monto original aprobado y no se prorratea ni se
   acredita al comercio. Es coherente con descontar la comisión completa del reembolso parcial.
5. **Plazo para reembolsar**: no está documentado. Depende del adquirente y del contrato; ofrecieron
   escalarlo a operaciones.

**Pendiente**: pedir la tabla de comisiones y retenciones de tarjeta de la cuenta del cliente (la
ofrecieron tres veces) y, con esos números, ajustar las constantes del spec 0032 antes de activar la
política. Hasta entonces, `REFUND_FEE_FROM_TERMS_VERSION` queda en `null`.

## Tabla de comisiones de la cuenta (soporte, 2026-09-23)

Tarjeta crédito/débito:

| Componente                      | Comisión |
| ------------------------------- | -------- |
| Comisión transacción adquirente | US$0,12  |
| Comisión servicios ONVO         | 1,65 %   |
| Emisión ONVO                    | 0 %      |
| Adquirencia ONVO                | 0,30 %   |
| Adquirencia procesador          | 0,20 %   |
| Emisión                         | 1,75 %   |
| Servicios procesador            | 0 %      |
| Comisión transacción ONVO       | US$0,13  |

Retenciones: IVA 0,777 % sobre la comisión; renta 0 %.

**Suma: 3,9 % + US$0,25 por cobro.** El porcentaje coincide con la página de precios; el fijo no (la
página dice US$0,35). Ejemplo de un cobro de US$60: comisión US$2,59 y retención de IVA US$0,02.

Las constantes del spec 0032 quedaron en 390 puntos básicos y 25 centavos. La retención de IVA **no**
se descuenta al turista: es acreditable en la declaración del operador. El soporte no pudo dar el total
de un cobro concreto; indicó verificarlo en la _balance transaction_ del pago (`fee` y `vatTax`).
