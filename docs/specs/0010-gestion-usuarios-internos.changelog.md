# Changelog — 0010 Gestión de usuarios internos

Spec: [0010-gestion-usuarios-internos.md](./0010-gestion-usuarios-internos.md)
Rama: feat/0010-gestion-usuarios-internos

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
