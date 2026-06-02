# Changelog — 0010 Gestión de usuarios internos

Spec: [0010-gestion-usuarios-internos.md](./0010-gestion-usuarios-internos.md)
Rama: feat/0010-gestion-usuarios-internos

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
