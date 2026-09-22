# Lanzamiento — estado y pasos pendientes (septiembre 2026)

Complementa a [cutover-produccion.md](cutover-produccion.md), que sigue siendo el runbook completo. Este documento registra qué cambió desde junio y el orden para lanzar **con cobro inmediato**. El cobro diferido del spec 0029 queda apagado hasta completar la prueba de 30 días con tarjeta real (Fase 6b del runbook).

Estado al 2026-09-21: `main` ya tiene todo `dev` (PR #73) y producción tiene aplicadas las migraciones hasta `…044` (verificado con `supabase migration list --linked`). El respaldo previo está en `boka trails/files/backups/prod-2026-09-21-pre-040/`, fuera del repo. Faltan la `…045` del spec 0031 y la `…046` del spec 0032, cuando se implementen.

## Lo que depende del cliente y de la abogada

Sin esto no se abre a reservas reales. La lista viva, con responsables, está en la página de lanzamiento compartida con el cliente.

- Aviso de privacidad y términos redactados por la abogada.
- Razón social, cédula jurídica, dirección y correo de privacidad del responsable.
- Persona que atiende solicitudes de datos e incidentes; plan de incidentes aprobado.
- Aviso y consentimiento firmados por guías y personal.
- Política de reembolso definitiva. Decidido el 2026-09-21: si el turista cancela por su cuenta con más de 24 h, se le devuelve lo pagado **menos la comisión de OnvoPay** (3,9 % + US$0,35); si cancela el operador, se reembolsa el 100 % (spec 0032). Falta:
  - confirmar la comisión exacta con un estado de cuenta real de OnvoPay (¿suma IVA?);
  - que la abogada valide la cláusula frente a la Ley 7472;
  - que los términos la incluyan.
- Supabase Pro (copias de seguridad; evita la pausa del plan gratuito) y transferencia del proyecto al cliente.
- Cómo corre el worker: Railway Hobby o Supabase Cron (spec 0030, sin aprobar, en el worktree `booking-platform-0030`).
- Dominio y DNS para Resend; OnvoPay en modo live con la URL del webhook; DSN de Sentry.

Los borradores legales para la abogada y el operador están fuera del repo, en `boka trails/files/legal/borradores/`.

## Orden de despliegue

1. **Código.** Mergear los PRs de los specs 0031 y 0032 a `dev`. Promover `dev → main` con **merge commit** (nunca squash).
2. **Base de datos.** Desde `main`, `npx supabase db push` contra el proyecto linkeado (`zkuoegsjxjgvzkwkqpdr`). Aplica `…040`–`…046` en orden. Verificar después con `npx supabase migration list --linked` que no quede ninguna pendiente. Antes del push, confirmar que el proyecto ya está en Pro o, como mínimo, descargar un respaldo manual.
3. **Variables.** Además de las tablas del runbook:
   - Web: `DEFERRED_CHARGE_ENABLED=false` (explícito, aunque es el default).
   - Web y worker: no setear `ONVOPAY_API_BASE_URL` ni `NEXT_PUBLIC_ONVOPAY_API_BASE_URL`; el default es la API de producción.
   - Web: `RESEND_API_KEY` **ya no se exige** (se quitó del schema en el spec 0028). El runbook todavía dice lo contrario.
   - Worker: `NOTIFICATIONS_ENABLED=true` solo cuando Resend y el dominio estén verificados; mientras tanto `false`.
   - Worker: `RETENTION_ENABLED=true`. Es lo que hace cumplir los plazos del registro de datos.
4. **Worker.** Levantarlo y confirmar en los logs una corrida de `generate-tour-instances` y una de `apply-retention`. Si se usa Railway: plan Hobby y **App Sleeping apagado**.
5. **Datos iniciales.** Primer admin (Fase 4b del runbook) y carga de tours reales desde el panel.
6. **Texto legal.** Cuando llegue de la abogada: reemplazar `privacy-body` y `terms-body` en `web/locales/es.json` y `en.json`, subir `PRIVACY_NOTICE_VERSION` y `TERMS_VERSION` en `shared/constants/legal.ts` a la fecha de publicación, y desplegar. En el mismo deploy, poner `REFUND_FEE_FROM_TERMS_VERSION` (en `shared/constants/policies.ts`) en esa misma fecha para activar el descuento de la comisión (spec 0032). Si los términos no incluyen la cláusula, dejarlo en `null`.
7. **Prueba completa en producción** (Fase 7 del runbook): reserva real de monto mínimo, correo en la bandeja de entrada, cancelación del turista con reembolso parcial (monto = total − comisión, verificado en el dashboard de OnvoPay), cancelación del staff por decisión del operador con reembolso total, cuadre de reportes.
8. **Tag** `v0.1.0` y recién entonces difundir la URL.

## Correcciones al runbook

- La Fase 6 dice que hay que registrar la base ante PRODHAB. **No hace falta** mientras los datos se usen solo para prestar el servicio (Ley 8968 art. 21; reglamento art. 44). Sí hacen falta los contratos de tratamiento con **Supabase, Vercel, Resend, Sentry y Railway**, y confirmar el rol de OnvoPay.
- La lista de encargados del runbook dice que OnvoPay recibe "cero datos personales". Con el cobro diferido encendido recibe nombre, correo y titular de la tarjeta. Con cobro inmediato recibe la tarjeta y el titular desde el navegador.
