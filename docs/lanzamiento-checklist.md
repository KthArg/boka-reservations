# Lanzamiento — estado y pasos pendientes (septiembre 2026)

Complementa a [cutover-produccion.md](cutover-produccion.md), que sigue siendo el runbook completo. Este documento registra qué cambió desde junio y el orden para lanzar **con cobro inmediato**. El cobro diferido del spec 0029 queda apagado hasta completar la prueba de 30 días con tarjeta real (Fase 6b del runbook).

Estado al 2026-09-27: `main` tiene todo `dev` (PR #81) y producción tiene aplicadas las migraciones hasta `…047` (verificado con `supabase migration list --linked`). Respaldos previos, fuera del repo: `boka trails/files/backups/prod-2026-09-21-pre-040/`, `…/prod-2026-09-23-pre-045/` y `…/prod-2026-09-27-pre-047/`. Los specs 0031, 0032 y 0033 están desplegados; el cobro diferido y su motor siguen apagados.

## Lo que depende del cliente y de la abogada

Sin esto no se abre a reservas reales. La lista viva, con responsables, está en la página de lanzamiento compartida con el cliente.

- Términos y aviso de privacidad definitivos publicados en el sitio (spec 0034, versión `2026-09-27`). Reembolso siempre del 100 % con 24 h o más; sin reembolso con menos de 24 h ni por no presentación; sin comisión descontada.
- **Datos del operador en el panel** (Configuración → Identidad del operador): razón social, cédula jurídica, domicilio, marca, correo de contacto, correo de privacidad, teléfono, horario de atención, número de declaratoria ICT y si tiene póliza de responsabilidad civil. **Mientras falte alguno, el checkout no vende** (compuerta del spec 0034) y los correos salen sin la identidad en el pie.
- Cada tour con "no incluye", requisitos y edades del tiquete de niño: sin eso no se puede reservar.
- Tolerancia de llegada tarde revisada en el panel (15 min por defecto).
- Persona que atiende solicitudes de datos e incidentes; plan de incidentes aprobado.
- Aviso y consentimiento para guías y personal: en la plataforma, no en papel.
- Factura electrónica **manual** (decisión del 2026-09-28): el operador está inscrito como emisor en Hacienda y emite con la herramienta gratuita un tiquete por reserva al confirmarse el pago, y una nota de crédito por cada reembolso. El contador define el código CAByS y la actividad. La automatización por la API de Hacienda queda para el spec 0037.
- Proveedores en la región que declara el aviso (EE. UU.): Railway, Resend y Sentry; Sentry en plan Developer (retención de 30 días, lo que dice el aviso).
- Specs 0035 (cierre por mínimo, cambio de fecha, revisión por clima, devolución por transferencia) y 0036 (anonimización y datos según el aviso) mergeados: los términos publicados describen ese comportamiento. `IDENTIFIER_HASH_SECRET` en Vercel (spec 0036).
- Supabase Pro (copias de seguridad; evita la pausa del plan gratuito) y transferencia del proyecto al cliente.
- Worker en Railway Hobby, corriendo, con `NOTIFICATIONS_ENABLED=true` y `RETENTION_ENABLED=true`: sin él no hay cierres por mínimo, correos ni borrado de datos, y los términos los prometen.
- Dominio y DNS para Resend; OnvoPay en modo live con la URL del webhook; DSN de Sentry.

Los borradores legales para la abogada y el operador están fuera del repo, en `boka trails/files/legal/borradores/`.

## Orden de despliegue

1. **Código en `dev`.** Mergear en orden los PR apilados: #84 (spec 0034), #85 (spec 0035) y el del spec 0036.
2. **Base de datos, antes de promover.** Respaldo manual si el proyecto no está en Pro (`supabase db dump`, con Docker corriendo). Después, desde `dev`, `npx supabase db push` contra el proyecto linkeado (`zkuoegsjxjgvzkwkqpdr`): aplica la `…048`, la `…049` y la `…050`. Tienen que estar antes del código. La `…050` crea el bucket `tour-images` de Storage. Verificar con `npx supabase migration list --linked`.
3. **Promover** `dev → main` con **merge commit** (nunca squash).
4. **Variables.** Además de las tablas del runbook:
   - Web: `DEFERRED_CHARGE_ENABLED=false` (explícito, aunque es el default).
   - Web: `IDENTIFIER_HASH_SECRET` (spec 0036), 32 caracteres o más (`openssl rand -base64 36`). **Sin ella la web no arranca en producción**, y los deploys de Preview de Vercel también corren con `NODE_ENV=production`: cargarla en Production y en Preview.
   - Worker: `DEFERRED_CHARGE_ENABLED=false` y `RELEASE_AUTHORIZATIONS_ONLY=false` (spec 0033). Los dos flags del cobro diferido, el de la web y el del worker, se prenden y se apagan juntos: la web encendida con el worker apagado deja reservas que nunca se cobran.
   - Web y worker: no setear `ONVOPAY_API_BASE_URL` ni `NEXT_PUBLIC_ONVOPAY_API_BASE_URL`; el default es la API de producción.
   - Web: `RESEND_API_KEY` **ya no se exige** (se quitó del schema en el spec 0028). El runbook todavía dice lo contrario.
   - Worker: `NOTIFICATIONS_ENABLED=true` solo cuando Resend y el dominio estén verificados; mientras tanto `false`.
   - Worker: `RETENTION_ENABLED=true`. Es lo que hace cumplir los plazos del registro de datos.
5. **Worker.** Levantarlo y confirmar en los logs una corrida de `generate-tour-instances` y una de `apply-retention`. Si se usa Railway: plan Hobby y **App Sleeping apagado**.
6. **Datos iniciales.** Primer admin (Fase 4b del runbook) y carga de tours reales desde el panel.
7. **Texto legal.** Ya está en el código (spec 0034): `web/content/legal/`, versiones en `shared/constants/legal.ts`. Una versión nueva se agrega como archivo nuevo en el registro, sin tocar las anteriores, que siguen visibles en `/terms/<versión>` y `/privacy/<versión>`. Llenar los datos del operador en el panel antes de abrir ventas.
8. **Prueba completa en producción** (Fase 7 del runbook): reserva real de monto mínimo, correo en la bandeja de entrada, cancelación del turista con 24 h o más y reembolso del 100 % (verificado en el dashboard de OnvoPay), cancelación del staff por decisión del operador con reembolso total, cuadre de reportes.
9. **Tag** `v0.1.0` y recién entonces difundir la URL.

## Después del lanzamiento

- Migración de limpieza del spec 0032: `DROP FUNCTION public.cancel_booking(uuid, text, integer, uuid)` con la firma explícita (sin ella falla por ambigüedad), y pasar a la firma nueva los tests que todavía usan la vieja (`cierres-menores-0028.test.ts`, `late-payment-refund.test.ts`).

## Correcciones al runbook

- La Fase 6 dice que hay que registrar la base ante PRODHAB. **No hace falta** mientras los datos se usen solo para prestar el servicio (Ley 8968 art. 21; reglamento art. 44). Sí hacen falta los contratos de tratamiento con **Supabase, Vercel, Resend, Sentry y Railway**, y confirmar el rol de OnvoPay.
- La lista de encargados del runbook dice que OnvoPay recibe "cero datos personales". Con el cobro diferido encendido recibe nombre, correo y titular de la tarjeta. Con cobro inmediato recibe la tarjeta y el titular desde el navegador.
