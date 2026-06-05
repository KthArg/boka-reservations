# Consulta a OnvoPay — comisiones en reembolsos

- **Estado**: pendiente de enviar
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
