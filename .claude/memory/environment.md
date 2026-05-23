# Entorno y configuración

## Servicios del MVP

- **Supabase**: pendiente crear proyecto `booking-dev`. URL y keys irán a `web/.env.local` y `worker/.env`.
- **OnvoPay**: pendiente crear cuenta del cliente. Sandbox accesible sin verificación KYC completa (`https://api.dev.onvopay.com`). Claves con prefijo `onvo_test_` y `onvo_live_`. Documentación: https://docs.onvopay.com/. SDK oficial: `@onvo/onvo-pay-js` en npm.
- **Resend**: pendiente. Verificación de dominio para email transaccional (subdominio inicial sugerido: `mail.<dominio>.com`).
- **Vercel**: pendiente conectar al repo de GitHub. Tier hobby es suficiente al inicio.
- **Railway**: pendiente crear proyecto vacío para el worker. Tier hobby $5/mes.
- **Dominio**: pendiente comprar (puede esperar a etapa final del roadmap).

## Servicios post-MVP planeados

- **PayPal Business CR (Merchant estándar, NO Platform)**: para sumar como pasarela secundaria orientada a turistas extranjeros que prefieren PayPal por confianza. Aprobado para CR como entidad receptora. Spec correspondiente a producir cuando el MVP esté estable.

## Servicios descartados

- **Stripe** (cualquier modalidad): no opera con merchants ubicados en CR. Solo viable si cliente registra entidad en US, lo cual fue descartado.
- **PayPal Commerce Platform**: requiere entidad US. No viable para nuestro caso.
- **OpenWA / WhatsApp APIs no oficiales**: riesgo de baneo, violación de TOS.
- **Twilio para WhatsApp/SMS**: descartado para MVP por costo y porque MVP usa solo email.
- **dLocal**: sirve para que plataformas extranjeras cobren en CR, no para que merchants en CR cobren. No aplica.
- **Mercado Pago**: no opera como merchant en CR.
- **Tilopay**: viable pero comisiones más altas que OnvoPay.
- **BAC Credomatic API directa**: viable pero API arcaica y onboarding presencial.

## Variables de entorno

Las variables se documentarán en `web/.env.example` y `worker/.env.example` apenas se inicialice el setup técnico (Etapa 2 del roadmap). Variables críticas anticipadas:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ONVOPAY_SECRET_KEY`, `ONVOPAY_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `APP_URL`

## Configuración pendiente

- Crear todas las cuentas de servicios externos (Etapa 0 del roadmap).
- Comprar dominio.
- Cliente debe crear cuenta OnvoPay (trámite digital rápido, sin presencial).
- Configurar verificación de dominio en Resend.

## Cosas que requieren acción del usuario manualmente

Estas tareas Claude no puede hacer; quedan para el usuario:

- Crear cuentas en servicios externos y obtener claves.
- Coordinar con el cliente la apertura de cuenta OnvoPay.
- Verificar dominios.
- Configurar DNS.
- Gestionar facturación de cada servicio.
- Definir y firmar acuerdo comercial con el cliente (modelo de cobro, alcance, SLA).
- Consultar con contador costarricense sobre obligaciones fiscales del cliente como operador turístico (registro ICT si aplica, facturación electrónica).

## Notas adicionales

- OnvoPay es Sociedad Anónima costarricense (cédula jurídica 3-101-815764) registrada ante SUGEF. La SUGEF supervisa solo en materia de prevención de legitimación de capitales, no de solvencia operativa del proveedor. Información a tener presente para diligencia debida.
