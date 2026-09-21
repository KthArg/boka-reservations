# Runbook de cutover a producción — booking-platform

Guía operativa, paso a paso, para levantar la plataforma en producción. Es el complemento
accionable del `pre-production-checklist` (memoria del proyecto): ese archivo es la fuente de
verdad de QUÉ falta; este runbook es el CÓMO, en orden, con los comandos y settings exactos.

> **Regla inviolable:** los secretos (claves, service role, API keys, webhook secret) van
> **siempre en el dashboard de cada servicio**, nunca en el repo, ni en `.env` commiteado, ni en
> la memoria. Este runbook nombra las variables; sus valores se cargan en cada plataforma.

## Alcance de la primera pasada

Levantar **toda la infraestructura en producción y validarla end-to-end** (smoke test con una
reserva real de monto mínimo), **sin abrir a tráfico real de turistas** hasta que el cliente
entregue el texto legal (privacidad/T&C). Motivo: la Ley 8968 prohíbe recolectar PII real con los
placeholders legales puestos (ver `pre-production-checklist`, sección Privacidad). Hasta entonces,
la app queda desplegada pero el cliente no difunde la URL pública.

## Arquitectura de despliegue

| Componente          | Plataforma                      | Cómo corre                                                                   |
| ------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| Web (Next.js)       | **Vercel**                      | Root directory `web/`, branch `main`, build `next build`                     |
| Worker (jobs)       | **Railway**                     | Root directory `worker/`, `pnpm install` + `pnpm start` (`tsx src/index.ts`) |
| DB + Auth + Storage | **Supabase** (proyecto de prod) | Migraciones `supabase db push`                                               |
| Email transaccional | **Resend**                      | El worker envía; dominio del cliente con DKIM/SPF                            |
| Pagos               | **OnvoPay** (live)              | Widget + webhook a la URL de prod                                            |
| Observabilidad      | **Sentry**                      | DSN de web (Vercel) y worker (Railway)                                       |

Producción se despliega desde **`main`** (hoy `main == dev`, specs 0001–0026 + rebrand). El worker
corre con **`tsx` en producción** (igual que en dev; decisión de cutover — evita el problema de
extensiones ESM de compilar a `dist` y reusa el runtime ya probado end-to-end).

## Variables de entorno

Listas **autoritativas**, derivadas de los validadores Zod (`web/lib/env.ts`, `worker/src/env.ts`).
Si falta una requerida, el proceso **lanza al arranque** (fail-fast).

### Vercel (web) — Project → Settings → Environment Variables (Production)

| Variable                         | Valor                                          | Secreto |
| -------------------------------- | ---------------------------------------------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | URL del proyecto Supabase de prod              | no      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | anon/publishable key de prod                   | no      |
| `SUPABASE_SERVICE_ROLE_KEY`      | service role key de prod                       | **sí**  |
| `ONVOPAY_SECRET_KEY`             | `onvo_live_…`                                  | **sí**  |
| `ONVOPAY_WEBHOOK_SECRET`         | webhook secret de prod (OnvoPay dashboard)     | **sí**  |
| `NEXT_PUBLIC_ONVOPAY_PUBLIC_KEY` | `onvo_live_pk_…`                               | no      |
| `RESEND_API_KEY`                 | `re_…`                                         | **sí**  |
| `APP_URL`                        | `https://<dominio-de-prod>`                    | no      |
| `INVITE_SIGNING_SECRET`          | generar nuevo: `openssl rand -base64 36`       | **sí**  |
| `NEXT_PUBLIC_SENTRY_DSN`         | DSN de Sentry (web) — opcional, activa Sentry  | no      |
| `RATE_LIMIT_ENABLED`             | `true` (kill-switch; dejar activo)             | no      |
| `CSP_REPORT_ONLY`                | `false` (enforcing). Ver nota de rollout abajo | no      |

- `NODE_ENV=production` lo setea Vercel solo.
- **Gotcha:** `web/lib/env.ts` **exige `RESEND_API_KEY`** aunque la web no envía emails (los envía el
  worker). Hay que setearla igual en Vercel o el build/arranque falla. (Follow-up opcional: hacerla
  opcional en el schema del web.)
- **CSP rollout (opcional):** para la primera pasada se puede poner `CSP_REPORT_ONLY=true`, observar
  violaciones reales en el dominio/Supabase/Sentry de prod, y luego flipear a `false`. Default
  `false` (enforcing) es válido porque ya se verificó en build de prod local.

### Railway (worker) — Service → Variables

| Variable                    | Valor                                                               | Secreto |
| --------------------------- | ------------------------------------------------------------------- | ------- |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key de prod                                            | **sí**  |
| `NEXT_PUBLIC_SUPABASE_URL`  | URL del proyecto Supabase de prod                                   | no      |
| `APP_URL`                   | `https://<dominio-de-prod>`                                         | no      |
| `ONVOPAY_SECRET_KEY`        | `onvo_live_…` (refunds + reconciliación)                            | **sí**  |
| `EMAIL_PROVIDER`            | `resend`                                                            | no      |
| `EMAIL_FROM`                | `Boka Verde <reservas@<dominio-cliente>>`                           | no      |
| `RESEND_API_KEY`            | `re_…`                                                              | **sí**  |
| `NODE_ENV`                  | `production`                                                        | no      |
| `SENTRY_DSN`                | DSN de Sentry (worker) — opcional, activa alertas de reconciliación | no      |
| `NOTIFICATIONS_ENABLED`     | `true` (default)                                                    | no      |
| `RETENTION_ENABLED`         | `true` (default)                                                    | no      |

- Sin `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` el worker **no arranca** (refinamiento Zod).
- `SMTP_HOST`/`SMTP_PORT` son solo para Mailpit en dev; no se setean en prod.

---

## Fase 2 — Supabase de producción

- [ ] Crear proyecto Supabase de prod (región más cercana a CR; password de DB fuerte y guardada).
- [ ] Anotar de **Settings → API**: Project URL, `anon` key, `service_role` key (esta última es secreta).
- [ ] **Settings → Database → Backups**: confirmar backups automáticos y política de retención.

## Fase 3 — Desplegar la base de datos

Desde la raíz del repo, con `main` checked out:

- [ ] `npx supabase login`
- [ ] `npx supabase link --project-ref <project-ref-de-prod>`
- [ ] `npx supabase db push` — aplica las **37 migraciones** (`…001`–`…037`): schema, RLS, funciones
      `SECURITY DEFINER` endurecidas, rate limits, retención/anonimización, prevención de sobreventa,
      guard de `payment_mismatch`. **Esto incluye todos los fixes de seguridad que la anon key pública
      requiere** (REVOKE execute a anon, etc.).
- [ ] `npx supabase config push` — empuja settings de `config.toml` soportados (incl. password policy
      del 0023 y templates de auth).
- [ ] **Dashboard → Authentication → Providers/Sign In → "Allow new users to sign up" = OFF**
      (invite-only; `config.toml` solo gobierna local — esto NO se hereda).
- [ ] **Dashboard → Authentication → Emails / SMTP**: configurar SMTP custom (Resend) para los emails
      de invitación de admin/staff y verificar que el template `invite` quede con el link a
      `/{locale}/auth/confirm?token_hash=…&type=invite&next=/reset-password`.
- [ ] **Dashboard → Authentication → URL Configuration**: `Site URL = https://<dominio-de-prod>`;
      `Redirect URLs` con `https://<dominio-de-prod>/**`.

### Verificaciones post-deploy de la DB

- [ ] Como **anon** (con la anon key de prod): `POST /rest/v1/rpc/confirm_booking` con la firma real
      → **401 permission denied** (no debe ejecutar el cuerpo). Igual para `cancel_booking`,
      `is_public_request`, etc.
- [ ] `POST /auth/v1/signup` como anon → **422 `signup_disabled`**.
- [ ] El login de un admin de prueba funciona (422 solo en signup, no en login).

## Fase 2b/4 — Vercel (web)

- [ ] Importar el repo en Vercel; **Root Directory = `web`**; Framework = Next.js; Production branch = `main`.
- [ ] Node 22 (Vercel respeta `engines`/`.nvmrc`).
- [ ] Cargar todas las variables de la tabla **Vercel (web)** (arriba).
- [ ] Deploy. Si el build falla, primer sospechoso = variable faltante (el env valida al arranque).

## Fase 2b/4 — Railway (worker)

- [ ] Crear proyecto/servicio en Railway desde el repo; **Root Directory = `worker`**; Node 22.
- [ ] El `worker/railway.json` fija `startCommand = pnpm start` (corre `tsx src/index.ts`), restart
      `ON_FAILURE` y un **`buildCommand` no-op**. Install = `pnpm install` (hay `worker/pnpm-lock.yaml`
      propio; el worker es self-contained, no importa `@shared` en runtime). El worker **no compila**:
      corre TS con `tsx` en runtime.
- [ ] **Gotcha (build):** Railpack (builder default de Railway) corre `pnpm run build` (`tsc`) por
      defecto, que **falla** porque los tests de integración importan `../../../web/types/database.js`
      y con Root Directory = `worker` la carpeta `web/` no está en el contexto. Por eso el `buildCommand`
      del `railway.json` lo saltea. Si configurás por UI en vez de por archivo: **Settings → Build →
      Custom Build Command** = `echo "sin build"`.
- [ ] **No exponer puerto/dominio**: el worker es un proceso de fondo (scheduler), no un server HTTP.
- [ ] Cargar las variables de la tabla **Railway (worker)** (arriba).
- [ ] Deploy y confirmar en logs `[worker] alive — <timestamp>` y que los jobs agendan
      (`generate-tour-instances`, `release-expired-holds`, `send-notifications`, `reconcile-pending-payments`,
      `cleanup-rate-limits`, `apply-retention`) sin error de env.

### Set reducido para la fase de validación (sin tráfico real)

Para validar que el worker arranca y agenda **sin** configurar Resend/dominio todavía, usar este set
mínimo (los emails quedan apagados, así que el proveedor no importa):

| Variable                    | Valor (validación)                              |
| --------------------------- | ----------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key de prod (secreto)              |
| `NEXT_PUBLIC_SUPABASE_URL`  | `https://zkuoegsjxjgvzkwkqpdr.supabase.co`      |
| `APP_URL`                   | `https://boka-reservations.vercel.app`          |
| `NODE_ENV`                  | `production`                                    |
| `NOTIFICATIONS_ENABLED`     | `false`                                         |
| `ONVOPAY_SECRET_KEY`        | `onvo_test_…` (sandbox; refunds/reconciliación) |

- Se omiten `EMAIL_PROVIDER`/`RESEND_API_KEY`: con el default `mailpit` y `NOTIFICATIONS_ENABLED=false`
  el job de notificaciones no envía ni abre SMTP. Al pasar a tráfico real → `EMAIL_PROVIDER=resend` +
  `RESEND_API_KEY` + `NOTIFICATIONS_ENABLED=true` (ver Fase 5).

## Fase 4b — Bootstrap del primer admin (invite-only)

El auto-registro está OFF y **no hay trigger** que cree `public.users` al crear un usuario de auth, así
que el primer admin se siembra a mano. El hook `custom_access_token_hook` inyecta `user_role` buscando
`public.users` **por `id`** (`WHERE id = user_id`), por eso la fila debe usar el **UUID del usuario de auth**.

- [ ] **Dashboard → Authentication → Users → Add user**: email + password; marcar **Auto Confirm User**.
- [ ] Copiar el **User UID** recién creado.
- [ ] **Dashboard → SQL Editor**, reemplazando el UUID, email y nombre:

  ```sql
  insert into public.users (id, email, role, full_name)
  values ('<AUTH_USER_UID>', '<email>', 'admin', '<Nombre Apellido>');
  ```

- [ ] Login en `https://boka-reservations.vercel.app/es/login` con esas credenciales → debe entrar al
      panel (`/es/dashboard`). Si redirige a login en loop, revisar que el **Custom Access Token Hook**
      esté registrado y apunte a `public.custom_access_token_hook` (Authentication → Hooks).

## Fase 5 — Dominio, DNS, email y webhook

- [ ] **Resend**: crear cuenta, agregar el dominio del cliente, cargar DKIM/SPF/return-path en DNS y
      verificar. Generar API key con scope `emails:send` → es el `RESEND_API_KEY`.
- [ ] **Vercel → Domains**: apuntar el dominio de prod (DNS del cliente). Confirmar que `APP_URL`,
      `Site URL` de Supabase y el dominio de Vercel son **el mismo origen** (evita el split
      `127.0.0.1`/`localhost` que rompía cookies en dev; en prod = un solo dominio).
- [ ] **OnvoPay (live)**: registrar la URL del webhook de prod
      (`https://<dominio-de-prod>/api/webhooks/onvopay`), tomar el **webhook secret** → cargarlo como
      `ONVOPAY_WEBHOOK_SECRET` en Vercel. Confirmar claves `onvo_live_*`.

## Fase 6 — Legal / PRODHAB (cliente — bloqueante para tráfico real)

> No abrir la URL pública a turistas hasta cerrar esto.

- [ ] Texto definitivo de privacidad y T&C reemplazando los placeholders de `/privacy` y `/terms`.
- [ ] Incrementar `PRIVACY_NOTICE_VERSION` en `shared/constants/legal.ts` al publicar el texto.
- [ ] Registro de la base ante PRODHAB y acuerdos de encargado de tratamiento (Resend/Supabase/OnvoPay).

## Fase 6b — Prueba de cobro diferido con tarjeta real (spec 0029)

> **Empezar al menos 30 días antes del go-live.** Aplica si el lanzamiento incluye el cobro diferido (`DEFERRED_CHARGE_ENABLED`). Deuda de pre-lanzamiento decidida el 2026-09-15.

**Por qué.** El sandbox de OnvoPay no interactúa con redes bancarias reales, así que no puede mostrar cómo responde un banco cuando se cobra una tarjeta guardada sin el cliente presente, días o semanas después de guardarla. Todo lo que depende de la API ya se verificó en sandbox (spec 0029 §5.1); esta prueba mide lo que depende del banco.

**Antes de empezar**

- [ ] La cuenta de OnvoPay tiene el modo live habilitado.
- [ ] Está claro de quién es la cuenta que recibe los cobros; si es del cliente, avisarle.
- [ ] Tarjeta virtual real creada solo para la prueba. Anotar su tipo (crédito, débito o prepago) y el banco: el resultado vale para ese tipo de tarjeta, no para todas. Las prepago y las de un solo uso suelen rechazar más este tipo de cobro.

**Reglas de seguridad**

- El número de tarjeta **nunca** pasa por scripts ni por Claude. Se ingresa en una página local que la tokeniza en el navegador con la publishable key live, igual que el checkout del spec; los scripts solo usan el `paymentMethodId`.
- Las llaves `onvo_live_*` van en un archivo local **fuera del repo**. El script las lee sin imprimirlas y aborta si no son live.
- Máximo **3 cobros** (6 si se suma la prueba opcional). Cobrar y reembolsar muchas veces con una tarjeta propia puede disparar alertas de fraude en la cuenta justo antes del lanzamiento.
- Montos de $1, reembolsados en el acto. Cada cobro puede costar unos centavos de comisión: no está confirmado si OnvoPay la devuelve en un reembolso.

**Pasos**

- [ ] **Día 0**: guardar la tarjeta, cobrar $1 desde el servidor y reembolsar. Anotar el `status` (`succeeded`, `requires_action` o rechazo) y el código de rechazo, si lo hay.
- [ ] **Día 7**: cobrar $1 con la misma tarjeta guardada y reembolsar. Anotar lo mismo.
- [ ] **Día 30**: repetir.
- [ ] Registrar fechas, montos y respuestas en `docs/onvopay-consulta-cobro-diferido.md`.

**Opcional — retención.** Solo si se reconsidera la autorización con captura posterior, descartada en el spec 0029 §5.1. El día 0 se crean tres autorizaciones de $1 con `captureMethod: "manual"` y se intenta capturar una a los 8 días, otra a los 15 y otra a los 29. Mirar en la app del banco cuándo desaparece cada retención del saldo.

**Cómo leer el resultado**

- Los tres cobros en `succeeded`, sin 3DS: se puede activar el flag con el tour canario.
- Algún `requires_action` o rechazo: antes de activar, revisar los flujos de reintento y 3DS y la meta de ≥95% de cobros sin intervención (spec 0029 §12).
- Funciona el día 7 pero falla el día 30: replantear con el cliente el tiempo máximo entre reserva y cobro (spec 0029, Q3).

## Fase 7 — Smoke test y go-live controlado

- [ ] **Prueba de cobro diferido con tarjeta real** (Fase 6b) terminada con resultado aceptable, si el lanzamiento incluye el cobro diferido.
- [ ] **Reserva real de monto mínimo**: checkout con tarjeta real → webhook real de OnvoPay →
      reserva `confirmed` → email de confirmación **llega al inbox (no spam)**.
- [ ] Probar **cancelación + refund** real (si la política lo permite en la ventana) → emails de
      cancelación y reembolso.
- [ ] Validar que los **reportes financieros** cuadran: ingreso neto = pagos `succeeded` − refunds
      `succeeded` (consulta manual al menos una vez).
- [ ] Confirmar Sentry recibe eventos (web y worker) si se cargaron los DSN.
- [ ] **Tag de release**: `git tag v0.1.0 && git push origin v0.1.0` (punto de retorno).
- [ ] Recién con el legal cerrado: difundir la URL pública.

## Notas y decisiones de cutover

- **Worker con `tsx` en prod:** `worker/package.json` → `start: tsx src/index.ts`, `tsx` movido a
  `dependencies`. Antes el `start` era `node dist/index.js` pero el `build` (`tsc`) tiene
  `noEmit:true` → nunca generaba `dist`; el worker no podía arrancar en Railway. Se optó por `tsx`
  (runtime idéntico al de dev, ya validado) en lugar de arreglar la compilación ESM→`dist`.
- **Migraciones pendientes de prod:** todas (`…001`–`…037`) se aplican en un `db push` limpio sobre el
  proyecto nuevo; no hay estado previo que reconciliar.
- **Kill-switches en prod:** `RATE_LIMIT_ENABLED` y `RETENTION_ENABLED` permiten desactivar rápido sin
  redeploy si algo se comporta mal. Dejar en `true`.
