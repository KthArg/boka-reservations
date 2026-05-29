# 0002 — Autenticación de usuarios internos

- **Estado**: implemented
- **Autor**: KthArg
- **Creado**: 2026-05-23
- **Última actualización**: 2026-05-29
- **Rama**: feat/0002-autenticacion-usuarios-internos
- **PR**: #4

## 1. Contexto y motivación

La Etapa 3 creó la tabla `public.users` con roles y políticas RLS que dependen del claim `user_role`
en el JWT de Supabase. Sin embargo, no existe ningún mecanismo de autenticación: no hay páginas de
login, no hay sesión, y los RLS de rol no funcionan en la práctica porque el claim nunca se inyecta.

Esta etapa implementa el sistema completo de autenticación para los usuarios internos del operador
(admin, staff, guide): páginas de login y recuperación de contraseña, un auth hook de PostgreSQL que
añade `user_role` al JWT, middleware de Next.js que protege las rutas del panel administrativo, y los
helpers de sesión necesarios para Server Components y Server Actions.

No hay registro público: los usuarios los crea un administrador directamente en Supabase. El sistema
es exclusivamente para usuarios internos del operador turístico.

## 2. Objetivos

- Implementar login por email + contraseña en `/[locale]/login`.
- Implementar flujo de recuperación de contraseña en `/[locale]/forgot-password` y `/[locale]/reset-password`.
- Crear migración con la función de auth hook que inyecta `user_role` en el JWT de Supabase.
- Actualizar `seed.sql` para que los usuarios demo existan en `auth.users` con contraseñas conocidas.
- Instalar y configurar `@supabase/ssr` para manejo de cookies de sesión en Next.js App Router.
- Crear clientes de Supabase diferenciados para server, browser y middleware.
- Crear helpers de sesión tipados (`getSession`, `requireAuth`, `requireRole`, `getCurrentUser`).
- Actualizar el middleware de Next.js para componer i18n (existente) + auth.
- Crear el layout del panel administrativo `(admin)/layout.tsx` con verificación de sesión.
- Crear un placeholder de dashboard `(admin)/dashboard/page.tsx`.
- Agregar claves i18n necesarias a `locales/es.json` y `locales/en.json`.
- Escribir tests de integración para los flujos de auth.

## 3. Fuera de alcance

- Magic link / login sin contraseña.
- Autenticación con proveedores OAuth (Google, GitHub, etc.).
- 2FA / MFA.
- Registro propio de usuarios (se crean desde Supabase Dashboard o en una etapa futura de admin).
- Panel de gestión de usuarios internos desde la UI (Etapa futura).
- Perfil de usuario editable desde la UI (Etapa futura).
- Rate limiting del endpoint de login (Etapa de hardening).
- Verificación del flag `active` en cada request del middleware (solo en `requireAuth` para evitar
  latencia; ver Decisiones).

## 4. Historias de usuario

> Como usuario interno, quiero poder iniciar sesión con mi email y contraseña para acceder al panel.

Criterios de aceptación:

- [ ] `/[locale]/login` muestra formulario con campos email y contraseña.
- [ ] Credenciales correctas redirigen al dashboard (o a `redirectTo` si estaba en la URL).
- [ ] Credenciales incorrectas muestran mensaje de error genérico sin revelar si el email existe.
- [ ] La sesión persiste al recargar la página.

> Como usuario interno con sesión activa, quiero poder cerrar sesión.

Criterios de aceptación:

- [ ] Acción de logout en el layout del panel destruye la sesión y redirige a `/[locale]/login`.
- [ ] Después del logout, intentar acceder al panel redirige a login.

> Como usuario interno que olvidó su contraseña, quiero recibir un email para restablecerla.

Criterios de aceptación:

- [ ] `/[locale]/forgot-password` muestra campo de email.
- [ ] Al enviar, siempre muestra "Si el email existe, recibirás instrucciones" (sin revelar existencia).
- [ ] El enlace del email lleva a `/[locale]/reset-password` donde se puede ingresar la nueva contraseña.
- [ ] Después de resetear, el usuario queda con sesión iniciada y redirige al dashboard.

> Como visitante no autenticado, quiero ser redirigido al login si intento acceder a rutas protegidas.

Criterios de aceptación:

- [ ] Cualquier ruta bajo `/(admin)/` sin sesión válida redirige a `/[locale]/login?redirectTo=<ruta>`.
- [ ] Después del login exitoso, se redirige a la ruta original.
- [ ] Las rutas `/(auth)/` (login, forgot-password) son accesibles sin sesión.

> Como sistema, quiero que el JWT de cada sesión incluya el rol del usuario para que las RLS funcionen.

Criterios de aceptación:

- [ ] `auth.jwt() ->> 'user_role'` retorna el rol correcto en todas las conexiones autenticadas.
- [ ] El claim se actualiza si el rol en `public.users` cambia (en el siguiente login).

## 5. Diseño técnico

### Stack

- **Supabase Auth** — email + contraseña. Maneja hashing de passwords, tokens de reset, sesiones JWT.
- **`@supabase/ssr`** — clientes Supabase con soporte de cookies para Next.js App Router (SSR-safe).
- **Auth hook de PostgreSQL** — función que añade `user_role` al JWT en cada generación de token.
- **Next.js middleware** — compone i18n (next-intl) + refresh de sesión + redirección de auth.

### Auth hook de PostgreSQL

Supabase permite registrar una función PostgreSQL como Custom Access Token Hook. Se ejecuta en cada
generación de access token e inyecta claims personalizados. La función va en una migración nueva:

```sql
-- supabase/migrations/20260523000007_create_auth_hook.sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims jsonb;
  user_role_val text;
BEGIN
  SELECT role::text INTO user_role_val
  FROM public.users
  WHERE id = (event->>'user_id')::uuid;

  claims := event->'claims';

  IF user_role_val IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role_val));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
```

> ⚠ **Paso manual obligatorio**: después de aplicar la migración, registrar el hook en Supabase
> Dashboard → Authentication → Hooks → "Custom Access Token" → `public.custom_access_token_hook`.
> En local: http://127.0.0.1:54323 → Authentication → Hooks.
> Documentar este paso en `docs/ops/supabase-hooks.md`.

### Clientes de Supabase (`@supabase/ssr`)

```
web/lib/db/
├── supabase-server.ts      → createServerClient (Server Components, Server Actions, Route Handlers)
├── supabase-browser.ts     → createBrowserClient (Client Components)
└── supabase-middleware.ts  → createServerClient para middleware (lee/escribe cookies de Request/Response)
```

La razón de tres archivos distintos es que cada contexto tiene una forma diferente de acceder a
cookies. Combinarlos en uno requeriría tipos condicionales que oscurecen la intención.

### Estructura de rutas

```
web/app/[locale]/
├── (auth)/
│   ├── layout.tsx                  # Layout sin sidebar (fondo de marca, centrado)
│   ├── login/
│   │   ├── page.tsx
│   │   ├── page.module.css
│   │   └── actions.ts              # signIn, signOut
│   ├── forgot-password/
│   │   ├── page.tsx
│   │   ├── page.module.css
│   │   └── actions.ts              # requestPasswordReset
│   └── reset-password/
│       ├── page.tsx                # Formulario de nueva contraseña
│       ├── page.module.css
│       └── actions.ts              # updatePassword
├── auth/
│   └── callback/
│       └── route.ts                # Route Handler: exchange code → session → redirect
└── (admin)/
    ├── layout.tsx                  # Sidebar, header, verifica sesión
    └── dashboard/
        └── page.tsx                # Placeholder: "Panel listo. Próximas etapas en construcción."
```

El Route Handler `auth/callback/route.ts` está fuera de los route groups porque es un endpoint de
API que no necesita layout. Recibe el `code` del email de reset, lo intercambia por sesión via
`supabase.auth.exchangeCodeForSession(code)`, y redirige al usuario a `/[locale]/reset-password`.

### Helpers de autenticación (`lib/auth/server.ts`)

```typescript
export async function getSession(): Promise<Session | null>;
export async function requireAuth(): Promise<Session>; // lanza AuthError si sin sesión
export async function requireRole(role: UserRole): Promise<Session>; // lanza AuthError si rol no coincide
export async function getCurrentUser(): Promise<Tables<'users'> | null>;
```

`requireAuth` verifica `active = true` en `public.users` además de la sesión. Si el usuario tiene
sesión válida pero `active = false` (fue deshabilitado), lanza error y el handler redirige a login.

`getSession` usa `supabase.auth.getUser()` (verifica contra auth DB), no `getSession()` que solo lee
cookies y puede estar stale.

### Middleware actualizado

```typescript
// web/middleware.ts — orden de ejecución:
// 1. Supabase: refrescar cookie de sesión si está por vencer
// 2. next-intl: detectar locale, reescribir URL
// 3. Auth guard: si ruta es protegida y no hay sesión → redirect a /[locale]/login?redirectTo=<path>
```

Rutas protegidas: paths que contienen `/dashboard`, `/tours`, `/bookings`, `/guides`, `/settings`
después del prefijo de locale. La lista se define como constante en `middleware.ts`.

Rutas públicas (sin auth): `/login`, `/forgot-password`, `/reset-password`, `/auth/callback`, y todo
lo que no sea del panel admin.

### Seed — usuarios en `auth.users`

```sql
-- Añadir al inicio de supabase/seed.sql (antes de INSERT INTO users)
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@bokatrails.com',
   crypt('admin1234', gen_salt('bf')),
   now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'carlos@bokatrails.com',
   crypt('guide1234', gen_salt('bf')),
   now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'staff@bokatrails.com',
   crypt('staff1234', gen_salt('bf')),
   now(), now(), now(), '{}', '{}')
ON CONFLICT (id) DO NOTHING;
```

Credenciales de desarrollo:

| Email                 | Password  | Rol   |
| --------------------- | --------- | ----- |
| admin@bokatrails.com  | admin1234 | admin |
| carlos@bokatrails.com | guide1234 | guide |
| staff@bokatrails.com  | staff1234 | staff |

### Variables de entorno nuevas

```bash
# .env.local (ya existen, confirmar que están configuradas)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<sb_publishable_...>
SUPABASE_SERVICE_ROLE_KEY=<sb_secret_...>    # solo server-side

# Nuevo — URL base para construir redirects en emails de reset
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`NEXT_PUBLIC_SITE_URL` se usa para construir el `redirectTo` del email de recuperación:
`${NEXT_PUBLIC_SITE_URL}/${locale}/auth/callback`.

### Claves i18n

Claves nuevas a agregar (en `es.json` y `en.json`):

```
auth.login.title
auth.login.email-label
auth.login.password-label
auth.login.submit
auth.login.forgot-password-link
auth.login.error-invalid-credentials
auth.login.error-generic
auth.forgot-password.title
auth.forgot-password.description
auth.forgot-password.email-label
auth.forgot-password.submit
auth.forgot-password.success-message
auth.forgot-password.back-to-login
auth.reset-password.title
auth.reset-password.new-password-label
auth.reset-password.submit
auth.reset-password.success-message
auth.logout
```

## 6. Flujos principales

### Login

```
GET  /es/login
     ← LoginPage (formulario)
POST server action signIn(FormData)
     → Zod: validar email + password no vacíos
     → supabase.auth.signInWithPassword({ email, password })
     ← error  → rerender con mensaje genérico (no revelar causa)
     ← success → redirect(redirectTo ?? '/es/dashboard')
```

### Logout

```
POST server action signOut()
     → supabase.auth.signOut()
     → redirect('/es/login')
```

### Forgot password

```
GET  /es/forgot-password
     ← ForgotPasswordPage (formulario email)
POST server action requestPasswordReset(FormData)
     → Zod: validar formato email
     → supabase.auth.resetPasswordForEmail(email, {
         redirectTo: `${NEXT_PUBLIC_SITE_URL}/${locale}/auth/callback`
       })
     ← siempre: mostrar "Si el email existe, recibirás instrucciones"
```

### Reset de contraseña (callback + nueva contraseña)

```
GET  /es/auth/callback?code=<code>
     → route.ts: supabase.auth.exchangeCodeForSession(code)
     ← success → redirect('/es/reset-password')
     ← error   → redirect('/es/forgot-password?error=link-expired')

GET  /es/reset-password
     ← ResetPasswordPage (formulario nueva contraseña)
POST server action updatePassword(FormData)
     → Zod: validar password min 8 caracteres
     → supabase.auth.updateUser({ password })
     ← success → redirect('/es/dashboard')
     ← error   → rerender con error genérico
```

### Middleware auth guard

```
Request → middleware.ts
          → supabaseMiddleware.auth.getUser() (refresca cookie si necesario)
          → next-intl: detectar locale
          → ¿pathname es ruta protegida?
              No  → next()
              Sí  → ¿getUser() retornó user?
                    Sí  → next()
                    No  → redirect(`/${locale}/login?redirectTo=${pathname}`)
```

## 7. Contratos de datos

### signIn (Server Action)

```typescript
// Input via FormData
const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Output: redirect o { error: string (i18n key) }
```

### requestPasswordReset (Server Action)

```typescript
const ResetRequestSchema = z.object({
  email: z.string().email(),
});

// Output: siempre { message: 'auth.forgot-password.success-message' }
// (nunca revela si el email existe)
```

### updatePassword (Server Action)

```typescript
const UpdatePasswordSchema = z.object({
  password: z.string().min(8),
});

// Output: redirect o { error: string (i18n key) }
```

### GET /auth/callback (Route Handler)

```
Query params: code (string)
Output: redirect a /[locale]/reset-password o /[locale]/forgot-password?error=link-expired
```

## 8. Manejo de errores

| Situación                     | Comportamiento                                                                |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Credenciales incorrectas      | `auth.login.error-invalid-credentials` (genérico, no revela causa)            |
| Email no válido en formulario | Validación de cliente + Zod server-side antes de llamar a Supabase            |
| Error de red con Supabase     | `auth.login.error-generic`                                                    |
| Usuario con `active = false`  | Mismo mensaje genérico que credenciales incorrectas                           |
| Sesión expirada durante uso   | Middleware redirige a login con `redirectTo` actual                           |
| Link de reset expirado        | Redirect a `/[locale]/forgot-password?error=link-expired` con mensaje visible |
| Code de callback inválido     | Mismo tratamiento que link expirado                                           |

## 9. Seguridad

- **No revelar existencia de email**: login y forgot-password devuelven respuestas idénticas en error.
- **CSRF**: las Server Actions tienen protección CSRF implícita por Same-Origin en Next.js.
- **Cookies `httpOnly`**: `@supabase/ssr` usa cookies `httpOnly`; el token no es accesible desde JS.
- **`SECURITY DEFINER` en el hook**: la función se ejecuta con privilegios del owner. `SET search_path = public` previene ataques de schema injection.
- **Validación Zod**: todos los inputs de server actions se validan antes de tocar Supabase.
- **`active` flag**: `requireAuth` verifica `active = true` en `public.users` consultando con la service key (bypasa RLS para leer su propio estado). Una sesión válida de un usuario desactivado no pasa `requireAuth`.
- **Service role key**: solo en server actions y helpers de servidor. Nunca en client components ni en `NEXT_PUBLIC_*` variables.
- **Contraseñas en seed**: solo existen en `seed.sql` de desarrollo. El seed no se aplica en producción.
- **Reset password URL**: `NEXT_PUBLIC_SITE_URL` debe configurarse correctamente en producción para que los links de reset apunten al dominio correcto.

## 10. Plan de tests

### Unit

- `lib/auth/server.ts` — `requireRole` lanza si el rol del JWT no coincide con el requerido.
- `lib/auth/server.ts` — `requireAuth` lanza si no hay sesión.
- Schemas Zod — `SignInSchema` rechaza email malformado y password vacío.
- Schemas Zod — `UpdatePasswordSchema` rechaza contraseñas menores a 8 caracteres.

### Integration (contra Supabase local)

- Login con credenciales correctas → sesión creada, `getUser()` retorna usuario.
- Login con contraseña incorrecta → error, sin sesión.
- Login con usuario `active = false` → `requireAuth` deniega el acceso.
- Logout → sesión destruida, `getUser()` retorna null.
- JWT claim: `admin@bokatrails.com` tiene `user_role = 'admin'` en el JWT (requiere hook registrado).
- JWT claim: `carlos@bokatrails.com` tiene `user_role = 'guide'` en el JWT.
- RLS con sesión real: un `staff` autenticado no puede hacer UPDATE en `tours`.
- RLS con sesión real: un `admin` autenticado puede hacer UPDATE en `tours`.

### Middleware

- Request a `/es/dashboard` sin sesión → redirect a `/es/login?redirectTo=/es/dashboard`.
- Request a `/es/login` sin sesión → pasa (no redirige).
- Request a `/es/dashboard` con sesión válida → pasa.
- Query param `redirectTo` persiste en el redirect de middleware.

> **Nota**: los tests de middleware son difíciles de hacer como integration tests estándar.
> Se pueden hacer con `vitest` mockeando la Request/Response de Next.js, o verificarse manualmente
> en el checklist de validación manual del PR.

## 11. Plan de implementación

1. Instalar `@supabase/ssr` en `web/`.
2. Crear `web/lib/db/supabase-server.ts`, `supabase-browser.ts`, `supabase-middleware.ts`.
3. Crear `supabase/migrations/20260523000007_create_auth_hook.sql`.
4. Actualizar `supabase/seed.sql` — añadir INSERT en `auth.users` antes del INSERT en `public.users`.
5. Correr `pnpm db:reset` para aplicar migración y seed nuevos.
6. **Manual**: registrar el hook en Supabase Dashboard local (http://127.0.0.1:54323).
7. Crear `web/lib/auth/server.ts` con los cuatro helpers.
8. Actualizar `web/middleware.ts` — componer Supabase session refresh + next-intl + auth guard.
9. Crear `web/app/[locale]/(auth)/layout.tsx`.
10. Crear `web/app/[locale]/(auth)/login/` (page, css, actions).
11. Crear `web/app/[locale]/(auth)/forgot-password/` (page, css, actions).
12. Crear `web/app/[locale]/(auth)/reset-password/` (page, css, actions).
13. Crear `web/app/[locale]/auth/callback/route.ts`.
14. Crear `web/app/[locale]/(admin)/layout.tsx` con sidebar placeholder y logout.
15. Crear `web/app/[locale]/(admin)/dashboard/page.tsx` (placeholder).
16. Actualizar `web/locales/es.json` y `en.json` con las claves de auth.
17. Agregar `NEXT_PUBLIC_SITE_URL` a `.env.example`.
18. Escribir tests de integración en `web/tests/integration/auth.test.ts`.
19. Validar manualmente: login, logout, forgot-password, redirect después de login.

## 12. Notas de implementación

- **`getUser()` vs `getSession()`**: en Server Components y middleware usar siempre
  `supabase.auth.getUser()` — verifica contra la DB de auth en cada request. `getSession()` solo lee
  cookies y puede estar desactualizado si el token fue revocado.

- **Composición del middleware**: next-intl `createMiddleware` retorna un handler que puede llamarse
  desde dentro de un middleware custom. El refresh de sesión de Supabase debe ocurrir primero para
  que las cookies estén actualizadas antes de que cualquier otra lógica las lea.

- **Hook registrado localmente**: el hook se registra en el Supabase Dashboard local. Al hacer
  `supabase db reset`, la función se recrea via migración, pero el registro del hook en el Dashboard
  persiste (es configuración del proyecto Supabase, no del schema). Si se hace `supabase stop` +
  `supabase start` (sin reset), el hook debería seguir registrado.

- **Reset de contraseña y `config.toml`**: verificar que `site_url` en `supabase/config.toml` esté
  configurado como `http://localhost:3000`. Esto afecta los emails de reset que Supabase envía en
  local (van a Inbucket en http://127.0.0.1:54324).

- **`(admin)/layout.tsx` y sesión**: el layout del panel llama a `getSession()` para obtener el
  usuario actual (para mostrar nombre en sidebar). Si no hay sesión, el middleware ya habrá
  redirigido antes de que el layout se renderice, así que este caso no necesita manejo especial.

- **Archivos a vigilar por el límite de 150 líneas**: `middleware.ts` y `lib/auth/server.ts`
  probablemente quedan cerca del límite. Si alguno lo supera, partir en helpers internos.

## 13. Decisiones y alternativas descartadas

| Decisión                                  | Alternativas consideradas                  | Razón                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email + contraseña                        | Magic link, OAuth                          | Más simple para un panel interno con pocos usuarios conocidos. Magic link requiere Resend configurado (no está en esta etapa). OAuth agrega complejidad de proveedores.                                                                                                                         |
| `@supabase/ssr`                           | `@supabase/auth-helpers-nextjs`            | `auth-helpers` está deprecado. `@supabase/ssr` es el reemplazo oficial.                                                                                                                                                                                                                         |
| Auth hook para JWT claim                  | Query adicional en cada request            | El hook añade el rol en el momento de login; no añade latencia en cada request posterior. Es el patrón recomendado por Supabase para custom claims.                                                                                                                                             |
| Verificar `active` solo en `requireAuth`  | Verificarlo en cada request del middleware | El middleware ya hace `getUser()`. Añadir una query a `public.users` en cada request agrega latencia. En MVP con operaciones de bajo volumen, es razonable aceptar que un usuario desactivado pueda navegar páginas estáticas del panel pero no ejecutar operaciones. Se revisará en hardening. |
| `/[locale]/login` (con prefijo de locale) | `/login` (sin locale)                      | Consistencia con el sistema i18n existente. El prefijo ya está en todas las rutas.                                                                                                                                                                                                              |
| Inserción directa en `auth.users` en seed | CLI `supabase auth admin create-user`      | La inserción SQL en seed.sql se aplica automáticamente con `db:reset`. El CLI requeriría un script separado.                                                                                                                                                                                    |
