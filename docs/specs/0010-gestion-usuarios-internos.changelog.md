# Changelog — 0010 Gestión de usuarios internos

Spec: [0010-gestion-usuarios-internos.md](./0010-gestion-usuarios-internos.md)
Rama: feat/0010-gestion-usuarios-internos

## 2026-06-02 — CAUSA RAÍZ encontrada: redirect de /auth/confirm cambiaba de origen (127.0.0.1 → localhost)

Tras el rediseño con `invite_set`, el navegador real seguía fallando con "enlace expirado" al fijar la contraseña (el POST de `/reset-password` daba `update-failed`). Diagnóstico definitivo:

- El email usa `{{ .SiteURL }}` = `http://127.0.0.1:3000`, así que el click entra a `/auth/confirm` en el origen **127.0.0.1**.
- `/auth/confirm` redirigía con `new URL(path, request.url)`, pero **Next dev normaliza `request.url` a `localhost`** aunque el browser entró por 127.0.0.1 (verificado con curl: pedido a 127 → `Location: http://localhost:3000/...`).
- La cookie `invite_set` (y antes la de sesión) se seteaba en **127.0.0.1** y el redirect iba a **localhost** → el navegador NO envía esa cookie al otro origen → `invite_set` ausente en el POST → cae al flujo de sesión → `update-failed`.
- **Por qué mis reproducciones con fetch nunca lo vieron**: mi cookie jar mandaba las cookies sin importar el origen. El bug es exclusivo de un navegador real que respeta el origen.

Esto explica retroactivamente TODOS los fallos de invitación en el navegador (contraseña equivocada, "sesión no coincide", "update-failed"): las cookies se partían entre `localhost` y `127.0.0.1`.

**Fix**: `/auth/confirm` arma los redirects con el **Host real del request** (`request.headers.get('host')` + proto), no con `request.url`. Así el flujo de invitación queda íntegro en el origen del email (127.0.0.1): cookie seteada y enviada en el mismo origen. Verificado: pedido a 127 → Location 127; pedido a localhost → Location localhost. En prod no aplica (un solo dominio).

## 2026-06-02 — Rediseño del seteo de contraseña: no depender de la sesión del navegador

**Síntoma (2º reporte en navegador)**: tras los fixes anteriores, al llegar a `/reset-password` y enviar el formulario, salía "no pudimos completar la invitación" (el guard `uid` se disparaba). Diagnóstico: la sesión del invitado que arma `verifyOtp` **no sobrevive** hasta el POST del Server Action en el navegador real (reproducí multi-salto server-side y la sesión SÍ persiste — el fallo es específico del navegador, no reproducible con fetch). El guard hacía su trabajo (no cambiaba la contraseña equivocada) pero bloqueaba el onboarding legítimo.

**Decisión**: dejar de depender de la sesión del navegador para fijar la contraseña del invitado.

**Cambios**:

- `/auth/confirm`: tras `verifyOtp`, emite cookie firmada **`invite_set`** (HMAC con `SUPABASE_SERVICE_ROLE_KEY`, HttpOnly, SameSite=Lax, 15 min) con el id del usuario verificado. Helper `lib/auth/invite-set-token.ts` (`signInviteSet`/`verifyInviteSet`), unit-testeado (firma, tamper, uid swap, expiración, malformado).
- `/reset-password` `updatePassword`: si hay `invite_set` válida → fija la contraseña vía **service client `auth.admin.updateUserById`** y redirige a `/login?reset=success`. Sin `invite_set` (forgot-password) → sigue el flujo viejo `updateUser` sobre la sesión propia.
- Eliminado el guard `uid`/`isSessionMismatch` (`guard.ts`/`guard.test.ts`) y la i18n `reset-session-mismatch`; ya no aplican. Agregada i18n `auth.password-set` + estilo `.success` en login.
- Constantes nuevas en `shared/constants/users.ts`: `INVITE_SET_COOKIE`, `INVITE_SET_TTL_MS`.

**Por qué es robusto**: el seteo se hace con el id firmado en la cookie (plain cookie que round-trippea confiable, a diferencia de la cookie de sesión troceada de Supabase) + admin API. No toca la sesión del navegador, así que es inmune a que un admin esté logueado o a que la sesión del invitado no persista. Seguridad equivalente al magic link: la cookie sólo se emite tras un `verifyOtp` válido, es HttpOnly, firmada y de vida corta.

**Verificado en sesión**: `/auth/confirm` emite `invite_set` con el uid correcto; `updateUserById` fija la contraseña; el invitado loguea con la nueva y el admin queda intacto. Web unit 76, integración 87, typecheck/lint limpios. Falta la confirmación final del usuario en navegador.

## 2026-06-02 — Fix del middleware: persistir el refresh de cookies de sesión

Continuación del fix anterior (a pedido del usuario, misma rama). `middleware.ts` devolvía `intlMiddleware(request)` y **descartaba** el `response` donde `getUser()` escribía las cookies de sesión refrescadas → al expirar el access token la sesión se "perdía". Ahora la respuesta base es la de next-intl y el cliente de Supabase se engancha a ESA respuesta (patrón oficial SSR + next-intl), así el refresh persiste.

**Verificado en runtime (dev server)**: ruta protegida sin sesión → 307 a login; `/` → 307 a `/es` (intl OK); `/es/dashboard` con sesión → 200; invitación (`/auth/confirm`) sigue resolviendo al invitado con `?uid=`. Unit 76, integración 87, typecheck/lint limpios. Cierra la deuda anotada en la entrada anterior.

## 2026-06-02 — Fix de seguridad: abrir invitación con otra sesión activa cambiaba la contraseña equivocada

**Síntoma (reportado por el usuario)**: estando logueado como `admin@bokatrails.com`, creó `qwe@qwe.com` y abrió el enlace de invitación **en el mismo navegador**. Resultado: se cambió la contraseña del **admin**, no la de qwe. En DB: qwe quedó `confirmed` y con `last_sign_in` (la sesión que arma `verifyOtp` se emitió server-side) pero **sin** contraseña propia; `admin1234` dejó de funcionar.

**Diagnóstico**: en `/reset-password`, `updateUser({ password })` actúa sobre la **sesión activa** del navegador. Al abrir la invitación con la sesión del admin presente, el `updateUser` corrió bajo el admin. No pude reproducirlo server-side (mi simulación con fetch siempre resolvía correctamente al invitado — la cookie de qwe reemplazaba la del admin, incluso troceada); el mecanismo exacto es específico del navegador real (prefetch / timing del POST del Server Action). Por eso el fix NO depende de adivinar ese mecanismo.

**Fix (defensa que hace imposible el cambio de cuenta equivocada):**

- `/auth/confirm` ahora hace `signOut({ scope: 'local' })` antes de `verifyOtp` (limpia la sesión residual) y agrega `?uid=<id del usuario verificado>` al redirect a `/reset-password`.
- `/reset-password` lleva el `uid` en un input oculto; `updatePassword` chequea `isSessionMismatch(uid, sessionUserId)` (guard puro en `guard.ts`) y **rechaza** el cambio si la sesión activa no es la del usuario del enlace → error `session-mismatch` (i18n nuevo). Si no viene `uid` (forgot-password viejo, mismo usuario) el guard no aplica: comportamiento sin cambios.

**Remediación aplicada**: restauré la contraseña del seed admin a `admin1234` vía Admin API.

**Verificado en sesión**: confirm redirige a `/reset-password?uid=<invitado>` y la sesión resuelve al invitado (happy path intacto); guard unit-testeado (5 casos). Web unit 76, integración 87, typecheck/lint limpios.

**Deuda anotada**: el middleware (`middleware.ts`) retorna `intlMiddleware(request)` descartando el `response` con las cookies refrescadas por `getUser()` — quirk latente de propagación de cookies; no se tocó (riesgo transversal), candidato a fix aparte.

## 2026-06-01 — Implementación completa (backend + UI + tests)

**Hecho**:

- `shared/constants/users.ts` (`UserManagementError`, `MANAGEABLE_ROLES`, `LOGIN_ROLES`) y schemas Zod `UserCreateSchema`/`UserUpdateSchema` (teléfono obligatorio para guía vía refine; mensajes = códigos i18n).
- Módulo `web/lib/users`: `guards.ts` (pura: self / último admin), `repository.ts` (listUsers/getUserById/emailExists/countActiveAdmins), `create.ts` (alta guía vs admin/staff con invite+rollback), `manage.ts` (update/setActive/resendInvite), `actions.ts` (server actions admin-only).
- Ruta `web/app/[locale]/auth/confirm/route.ts` (verifyOtp con token_hash) + template `supabase/templates/invite.html` + `[auth.email.template.invite]` en config.toml.
- `getGuideUpcomingTours` (0009) ahora chequea `users.active`: guía desactivado → null aunque el token siga vigente.
- UI `/dashboard/users`: lista con filtros (rol/estado), `UserFilters`, `UserRowActions` (activar/desactivar/reenviar), `new`/`[id]/edit` con `UserForm` reusable. Nav "Usuarios" visible solo para admin. Namespace i18n `users` en es.json y en.json.
- Tests: unit `guards.test.ts` (5) + `schema.test.ts` (8); integración `users-management.test.ts` (8: guía sin auth, staff con auth mismo id, email duplicado, no-admin, guía sin teléfono, update, toggle active, auto-desactivación bloqueada) + caso de guía desactivado en `guide-view.test.ts`.

**Por qué / decisiones**:

- Reads del repo vía server client (RLS admin-only, defensa en profundidad); mutaciones vía service client (la Admin API lo exige). En tests se mockea `@/lib/db/supabase-server` → service client (patrón documentado en `bookings-repository.test.ts`).
- Errores de negocio viajan como códigos del enum; el cliente traduce con `t.has(...)` + fallback `errors.generic`. Evita acoplar mensajes en el server y mantiene i18n.
- El guard del último admin se cubre de forma determinística en unit (la versión integración sería frágil al conteo real de admins del seed); integración cubre el wiring (toggle + auto-desactivación).

**Resultados verificados** (corridos en esta sesión):

- Web unit: 71 pasan (eran 58; +13).
- Web integración: 87 pasan (eran 78; +9). El alta de staff creó una cuenta de auth real vía `inviteUserByEmail` (GoTrue local) y verificó el id compartido.
- typecheck limpio, lint 0 errores (warnings preexistentes ajenos a esta feature).

**Pendiente**:

- Nada de código. Antes de probar el email de invitación a mano: **reiniciar Supabase local** (`npx supabase stop && npx supabase start`) para que cargue el nuevo template `invite`. Verificar en prod que `site_url`/SMTP estén configurados (pre-production-checklist).

## 2026-06-01 — Arranque: corrección del mecanismo de invitación en el spec

**Hecho**:

- Creé la rama `feat/0010-gestion-usuarios-internos` desde `dev` e inicié este changelog.
- Releí spec + skills + código de referencia (0008 tours CRUD, 0009 guías/departures, auth forgot-password/callback/reset).
- Corregí el spec (secciones 5, 8, 9): la invitación de admin/staff NO puede reusar `resetPasswordForEmail` tal cual (es PKCE/browser-bound; el verifier nunca llega al browser del invitado).

**Por qué / decisiones**:

- Mecanismo elegido, server-side y sin depender del browser: `inviteUserByEmail` (Admin API) + template `invite` que apunta a `/auth/confirm` + `verifyOtp({ token_hash, type })`. Es el patrón oficial de Supabase para SSR.
- Aislamiento deliberado: sólo se personaliza el template `invite` y se agrega `/auth/confirm`. El flujo de forgot-password (template `recovery` + `/auth/callback` PKCE) queda intacto para no arriesgar regresión en auth ya validado. El usuario pidió priorizar seguridad y robustez.
- Orden transaccional de `createUser` admin/staff: invite (crea auth) → insert `public.users` con el mismo id → rollback con `deleteUser` si el insert falla. Email único chequeado contra `public.users` antes de tocar auth.

**Pendiente**:

- Constantes + schemas Zod (`UserCreateSchema`/`UserUpdateSchema`).
- Módulo `lib/users` (repository, guards puros, create/update/deactivate, server actions).
- `/auth/confirm` + template invite + verificación de que la sección queda admin-only.
- Modificar `getGuideUpcomingTours` (0009) para chequear `users.active`.
- UI `/dashboard/users` (lista/new/edit/acciones) + nav admin-only + i18n.
- Tests unit (Zod, guard último admin) e integración (createUser guía/staff, deactivate, guía desactivado → vista null).
