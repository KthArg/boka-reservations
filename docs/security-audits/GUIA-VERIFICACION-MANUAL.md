# Guía de verificación manual — auditoría de seguridad

El Security Council lee **código y configuración versionada**. Hay cosas que **no puede verificar solo**: dependen de los dashboards de los servicios, de tener el sistema corriendo, o de un humano atacando el sistema en vivo. Esta guía lista esas verificaciones para que el usuario las ejecute manualmente antes de ir a producción con dinero y datos reales.

Cada reporte del council remite a esta guía en su sección "Límites de esta auditoría". Marcá cada ítem a medida que lo verifiques.

---

## 1. Dashboards de servicios

### Supabase

> **La config de Auth está versionada en `supabase/config.toml` → aplicarla con `supabase config push`, no a mano.** Los settings de Auth (auto-registro, hook de token, expiración de JWT, política de password) ya tienen el valor correcto en el repo. Al provisionar el proyecto de **producción**, enlazalo y empujá la config para que esos defaults se apliquen solos, en vez de depender de clics manuales (que arrancan con valores inseguros por defecto):
>
> ```
> supabase link --project-ref <ref-del-proyecto-de-produccion>
> supabase config push
> ```
>
> Después, confirmá en el dashboard que quedó como dicen los ítems de abajo. Esto convierte el cierre del auto-registro (P1-2 de la auditoría) en algo **enforced desde el repo**, no en un recordatorio frágil.

- [ ] **Auto-registro deshabilitado (P1-2 de la auditoría)** _(local OK 2026-06-14: `POST /auth/v1/signup` → `422 signup_disabled`; FALTA confirmar en el dashboard del proyecto hosted de PROD)_: confirmar que **"Allow new users to sign up" está OFF** (Authentication → Sign In / Providers). Corresponde a `[auth].enable_signup = false` en `config.toml` (spec 0020); `config push` lo aplica. ⚠️ Si quedara ON, se reabre el vector por el que un `authenticated` auto-registrado podía leer la PII de los guías. (Nota: `[auth.email].enable_signup = true` es intencional y NO es un agujero — el switch global ya bloquea el signup; ver comentario en `config.toml`.)
- [ ] **Auth hook**: `custom_access_token_hook` está declarado y habilitado en `config.toml` (`[auth.hook.custom_access_token] enabled = true`), así que `config push` lo aplica. Confirmá en Authentication → Hooks que quedó **activo** y apuntando a la función; si el panel no lo muestra activo, registralo a mano. El claim `user_role` depende de este hook: sin él, `requireRole/requireAnyRole` rompen el panel. (En local, re-registrar tras cada `db reset` si hace falta.)
- [ ] **Política de contraseñas**: subir `minimum_password_length` a ≥8 con complejidad (hoy 6; P2/INFRA-02). Es `[auth]` en `config.toml` → también viaja por `config push`.
- [ ] **Resto de config de Auth**: expiración de sesiones/JWT, confirmación de email, rate limits de auth.
- [ ] **RLS a nivel proyecto**: confirmar que RLS está habilitado en todas las tablas sensibles (el código define las políticas, pero confirmá el estado real en el dashboard → Database → Tables).
- [ ] **Políticas de Storage buckets**: revisar cada bucket; confirmar cuáles son públicos vs privados y que ninguno exponga archivos que deban ser privados.
- [ ] **Connection pooling**: confirmar que está activo y bien dimensionado para el worker + web.
- [ ] **API auto-generada**: confirmar que no haya tablas expuestas vía la API REST/GraphQL auto-generada sin protección de RLS.
- [ ] **Logs de acceso**: revisar por anomalías o accesos inesperados.
- [ ] **Cifrado en reposo**: confirmar (es estándar de Supabase, pero dejarlo verificado para el inventario de PII).

### Vercel

- [ ] **Variables de entorno scopeadas por ambiente**: confirmar que production / preview / development tienen los valores correctos y que **preview no usa secretos de producción**.
- [ ] **Preview deployments**: que no usen datos de producción ni expongan secretos reales; activar protección por password si los previews son accesibles públicamente.
- [ ] **Dominio y certificado HTTPS**: dominio configurado, certificado válido, HTTPS forzado (redirect de HTTP).
- [ ] **Logs**: confirmar que no se registren secretos ni PII en exceso (cruzar con hallazgos PRIV/INFRA).

### Railway (worker)

- [ ] **Variables de entorno del worker**: bien manejadas, sin secretos en logs de build/deploy.
- [ ] **Puertos**: que no haya puertos expuestos innecesariamente (el worker no debería exponer HTTP público si no lo necesita).
- [ ] **Logs**: revisar por filtración de secretos o PII.

### OnvoPay

- [ ] **Configuración de webhooks** _(sandbox vía ngrok verificado e2e 2026-06-14: webhook real de OnvoPay confirmó la reserva y el secreto coincide con el local; FALTA la config de PROD —URL + secreto live)_: URL del endpoint correcta (`/api/webhooks/onvopay`), **secreto del webhook configurado** y coincidente con `ONVOPAY_WEBHOOK_SECRET`.
- [ ] **Llaves live vs test** (nota 2026-06-14: el pentest usó solo llaves `onvo_test_` en sandbox): confirmar que las llaves `onvo_live_` **no se usaron en testing** y que producción usa live, no test.
- [ ] **Cuenta del cliente**: confirmar que la cuenta OnvoPay del cliente está activa, verificada (KYC) y configurada para recibir los pagos.

### Resend

- [ ] **Dominio verificado**: el dominio de envío está verificado.
- [ ] **SPF / DKIM / DMARC**: configurados correctamente en el DNS para evitar spoofing y que los emails no caigan en spam.
- [ ] **API key con permisos mínimos**: que la key tenga solo los permisos necesarios (envío), no administración total.

---

## 2. Verificaciones con el sistema corriendo

Requieren el sistema desplegado (o local con datos de prueba) y, en pagos, tarjetas de prueba de OnvoPay.

- [x] **Tampering de montos en pago** ✅ (2026-06-14, pentest activo — ver `2026-06-14-pentest-activo.md`): ejecutar el flujo de pago completo con tarjeta de prueba e intentar **manipular el monto** desde las herramientas de desarrollador del browser (editar el body del request, el precio en el DOM). Confirmar que el server recalcula y rechaza/ignora el valor del cliente.
- [ ] **Acceso a reservas ajenas (IDOR)** _(parcial 2026-06-14: P1-1 enmascarado en checkout/success + RLS bloquea lectura anon/staff de reservas ajenas; falta swap de tokens de magic link entre reservas)_: intentar acceder a reservas de otros modificando IDs o tokens en las URLs (magic link de otra reserva, IDs incrementales).
- [ ] **Rutas de admin sin autorización** _(parcial 2026-06-14: denegación de privilegios de anon/staff verificada vía API —RPC 401/403, RLS, INSERT bloqueado— + open-redirect F-1 OK; falta caminar los guards de UI sin sesión y con rol guide)_: intentar acceder a rutas `(admin)` **sin sesión** y **con sesión de rol bajo** (staff, guide). Confirmar redirect/403.
- [x] **Webhooks falsificados** ✅ (2026-06-14: secreto malo/ausente → 400 en localhost y ngrok; replay idempotente; mismatch de monto → payment_mismatch): enviar al endpoint `/api/webhooks/onvopay` un POST **sin el secreto válido** (o con uno incorrecto) y confirmar que se rechaza sin tocar la DB. Probar también **replay** del mismo evento válido dos veces y confirmar idempotencia.
- [x] **Rate limiting** ✅ (2026-06-14: forgot-password corta al 4º intento → 429; spoofing de `X-Forwarded-For` no probado en local —Vercel lo reescribe en prod): hacer requests repetidos a login, magic link y creación de reserva; confirmar que el límite se activa y no es trivial de evadir (probar variar `X-Forwarded-For`).
- [ ] **Secretos en el cliente**: revisar el HTML/JS servido al browser (ver source, bundle de Next) buscando secretos filtrados (service role key, claves de OnvoPay/Resend, connection strings).
- [x] **Headers de seguridad en runtime** ✅ (2026-06-14: CSP/HSTS/X-Frame DENY/nosniff/Referrer-Policy/Permissions-Policy presentes en `curl -I`): con devtools o `curl -I`, confirmar que CSP, HSTS, X-Frame-Options/frame-ancestors, X-Content-Type-Options, Referrer-Policy y Permissions-Policy llegan en las respuestas reales.
- [x] **PII en emails reales** ✅ (2026-06-14: confirmación + cancelación entregados a Mailpit con datos solo de la propia reserva; refund e2e real OK. Pendiente con Resend real en prod): enviar los emails transaccionales (confirmación, cancelación, recordatorio, asignación de guía, refund) y confirmar que no filtran datos de terceros ni de otras reservas.

---

## 3. Pentesting profesional

Para un sistema que maneja **dinero y datos personales**, se recomienda contratar al menos una vez una **auditoría de penetración profesional externa** antes de escalar el volumen.

El council deja el código sólido y cierra lo evidente, pero **no reemplaza a un humano atacando el sistema en vivo** con herramientas especializadas (fuzzing, interceptación de tráfico, cadenas de explotación, ingeniería social). El reporte del council es un **excelente punto de partida** para definir el scope de ese pentest: entregalo al pentester como mapa del sistema y de los controles ya implementados.

- [ ] Definir scope del pentest a partir del último reporte de `docs/security-audits/`.
- [ ] Contratar pentest externo antes de escalar volumen.

---

## 4. Revisión legal y fiscal

El cumplimiento legal pleno es responsabilidad del **cliente** (el operador turístico), no del sistema. El sistema lo facilita; el cliente lo cumple.

- [ ] **Ley 8968 (protección de datos, PRODHAB)**: consultar con un abogado sobre obligaciones de protección de datos — aviso de privacidad, consentimiento, registro de bases de datos ante PRODHAB si aplica, atención de derechos de acceso/rectificación/eliminación, política de retención.
- [ ] **Obligaciones fiscales y de registro**: consultar con un contador costarricense sobre facturación electrónica, impuestos, y registro ante el ICT (Instituto Costarricense de Turismo) si aplica a la actividad del cliente.
- [ ] **Términos y condiciones**: tener T&C y política de cancelación/refund publicados y aceptados por el turista en el checkout.

---

> Esta guía se mantiene junto a los reportes del council. Actualizala si cambian los servicios o aparecen nuevas verificaciones que el council no pueda cubrir desde el código.
