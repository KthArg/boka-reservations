# Changelog — 0002 Autenticación de usuarios internos

Spec: [0002-autenticacion-usuarios-internos.md](./0002-autenticacion-usuarios-internos.md)
Rama: feat/0002-autenticacion-usuarios-internos

## 2026-05-22 — Implementación completa, lista para PR

**Hecho**:

- 3 migraciones adicionales en `supabase/migrations/`:
  - `000007_create_auth_hook.sql`: función `custom_access_token_hook` que inyecta el claim `user_role` en cada JWT generado por Supabase. Requiere registro manual en Supabase Dashboard → Authentication → Hooks.
  - `000008_security_hardening.sql`: revoca acceso al schema GraphQL para `anon` y `authenticated`; fija `search_path = ''` en `trigger_set_updated_at` para prevenir search path injection.
  - `000009_fix_rls_grants_and_performance.sql`: revoca SELECT de `anon` en todas las tablas (innecesario y amplía superficie GraphQL); reescribe todas las políticas RLS con el patrón `(select auth.jwt() ->> 'user_role')` en lugar de `auth.jwt() ->> 'user_role'` para que PostgreSQL evalúe el JWT como InitPlan (una vez por query) en vez de correlated subquery (una vez por fila). Fusiona `users_update_admin` + `users_update_self` en política única `users_update`.
- Clientes de Supabase diferenciados para cada contexto:
  - `web/lib/db/supabase-server.ts` — para Server Components y Server Actions (cookies vía `next/headers`).
  - `web/lib/db/supabase-browser.ts` — para Client Components.
  - `web/lib/db/supabase-middleware.ts` — para el middleware de Next.js (refresca sesión en cookies sin cookies async).
- Auth helpers en `web/lib/auth/server.ts`:
  - `getSession()` — retorna `AuthUser` (User + `userRole` decodificado del JWT) o `null`.
  - `getCurrentUser()` — retorna la fila `public.users` del usuario autenticado o `null`.
  - `requireAuth()` — lanza `AuthError('UNAUTHENTICATED')` si no hay sesión o `AuthError('ACCOUNT_INACTIVE')` si `users.active=false`.
  - `requireRole(role)` — lanza `AuthError('UNAUTHORIZED')` si el rol no coincide.
  - Clase `AuthError` con código tipado: `UNAUTHENTICATED | UNAUTHORIZED | ACCOUNT_INACTIVE`.
- Server Actions en `web/lib/auth/actions.ts`: `signOut()` destruye sesión y redirige a `/[locale]/login`.
- Páginas de autenticación en `web/app/[locale]/(auth)/`:
  - `login/page.tsx` + `login/actions.ts` (`signIn`): form con email + contraseña; errores genéricos sin revelar existencia de email; soporte de `redirectTo` query param.
  - `forgot-password/page.tsx` + `ForgotPasswordForm.tsx`: solicita email, siempre muestra "si existe recibirás instrucciones".
  - `reset-password/page.tsx` + `reset-password/actions.ts`: permite ingresar nueva contraseña; redirige al dashboard si exitoso.
  - `auth/callback/route.ts`: handler de callback OAuth / magic link de Supabase.
- Layout admin en `web/app/[locale]/(admin)/layout.tsx`: shell con sidebar básico (brand, nav placeholder, email del usuario, botón logout). Carga `getCurrentUser()` server-side.
- Dashboard placeholder en `web/app/[locale]/(admin)/dashboard/page.tsx`.
- Middleware actualizado en `web/middleware.ts`: compone i18n (next-intl) + auth. Protege los segmentos `/dashboard`, `/tours`, `/bookings`, `/guides`, `/settings`; redirige a `/[locale]/login?redirectTo=<path>` si no hay sesión.
- Tests de integración en `web/tests/integration/auth.test.ts`:
  - Login correcto crea sesión; login incorrecto retorna error.
  - Logout destruye sesión.
  - Usuario con `active=false` puede obtener sesión (el guard se aplica en `requireAuth`, no en Supabase Auth directamente).
  - RLS: staff autenticado no puede modificar tours; sí puede leerlos.
  - RLS: admin autenticado puede modificar tours.
  - RLS: usuario puede actualizar su propio `full_name` pero no su `role`.
  - JWT claim: admin tiene `user_role=admin` en el payload; guide tiene `user_role=guide`.

**Por qué / decisiones**:

- El claim `user_role` se decodifica manualmente del JWT en `getSession()` en vez de hacer un `SELECT` a `public.users` en cada llamada. Razón: evitar una query extra a DB para cada verificación de sesión. El JWT ya lleva el rol gracias al auth hook.
- `requireAuth()` sí hace un `SELECT` a `public.users` para verificar `active=false`. Es intencional: el JWT no tiene el flag `active` (cambiaría solo al renovar el token), así que se consulta en cada request de ruta protegida. El overhead es una query por request en rutas admin, aceptable para MVP.
- Las dos políticas `users_update_admin` + `users_update_self` se fusionaron en `users_update` para evitar que PostgreSQL evalúe ambas en cada UPDATE. Técnica documentada en Supabase performance guidelines.
- El middleware no verifica el rol (solo la existencia de sesión). El control por rol se delega a `requireRole()` en las páginas que lo necesiten. Esta separación de responsabilidades evita que el middleware sea el único punto de control y permite fácil extensión cuando hay más rutas con roles específicos.
- `search_path = ''` en el trigger evita search path injection aunque en este proyecto el riesgo sea bajo; es práctica defensiva de SQL.

**Pendiente**:

- Nada — feature lista para PR.

**Notas para retomar**:

- El auth hook en `000007` requiere registro manual en el Supabase Dashboard después de aplicar la migración. Para desarrollo local: `http://127.0.0.1:54323 → Authentication → Hooks → Custom Access Token → public.custom_access_token_hook`. Sin este paso, `user_role` no aparece en el JWT y las políticas RLS basadas en ese claim fallan.
- Para configurarlo en Supabase local automáticamente (sin registro manual), agregar en `supabase/config.toml` la sección `[auth.hook.custom_access_token]` — pendiente de implementar para mejorar el DX local.
- Los tests de integración requieren `supabase start` (Docker Desktop). El seed crea los usuarios `auth.users` con contraseñas conocidas (`admin1234`, `staff1234`, `guide1234`) necesarios para los tests.
- La variable `SUPABASE_SERVICE_ROLE_KEY` en los tests usa el default de `supabase start` si no está en `.env`. En CI, configurar ambas variables de entorno del Supabase local.
