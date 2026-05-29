# 0001 — Modelo de datos base

- **Estado**: implemented
- **Autor**: KthArg
- **Creado**: 2026-05-23
- **Última actualización**: 2026-05-29
- **Rama**: feat/0001-modelo-de-datos-base
- **PR**: #3

## 1. Contexto y motivación

Boka Trails es una plataforma de reservas para un operador turístico único en Costa Rica que ofrece tours de senderismo y birdwatching. El modelo de datos base define las entidades fundamentales sobre las que se construirá toda la lógica de reservas, pagos y operación.

Este spec cubre únicamente las tablas de usuarios internos, tours, precios y schedules recurrentes. Las entidades de reservas (`bookings`), instancias de tour (`tour_instances`) y notificaciones se definen en specs posteriores.

## 2. Objetivos

- Definir el schema PostgreSQL para `users`, `tours`, `tour_pricing` y `tour_schedules` con constraints, índices y RLS apropiados.
- Establecer los enums de dominio (roles, estados, tipos de ticket, monedas) como tipos nativos de PostgreSQL y como constantes en `shared/`.
- Generar tipos TypeScript desde el schema de Supabase para usar en web y worker sin divergencia.
- Proveer un `seed.sql` reproducible con datos demo suficientes para desarrollar las etapas siguientes.

## 3. Fuera de alcance

- Tabla `tour_instances` (instancias fechadas generadas desde schedules) — Etapa 6.
- Tabla `bookings` y `booking_tickets` — Etapa 8.
- Tabla `notifications` — Etapa 9.
- Tabla `audit_logs` — Etapa 12.
- Signup público de turistas (no hay tabla de clientes; los datos del turista van en `bookings`).
- Carga de imágenes de tours (URLs externas, fuera del MVP).
- Precios multi-moneda independientes (el precio base es USD; CRC es referencial).

## 4. Historias de usuario

> Como admin, quiero que el sistema tenga una estructura de datos sólida desde el inicio, para que todas las features siguientes se construyan sin retrabajos de schema.

Criterios de aceptación:

- [ ] Las migraciones se aplican desde cero en una DB limpia sin error.
- [ ] Los tipos generados por Supabase se importan en código TypeScript sin errores.
- [ ] El seed carga datos demo con al menos 2 tours, precios y schedules.
- [ ] RLS impide que un usuario con rol `guide` modifique tours o precios.

## 5. Diseño técnico

### Convenciones generales

- UUIDs como PK en todas las tablas (`gen_random_uuid()`).
- `created_at` y `updated_at` en todas las tablas; `updated_at` se actualiza via trigger.
- Soft delete: ninguna tabla usa hard delete. Estado controlado por columna `status` o `active`.
- Contenido bilingüe: columnas separadas `*_es` / `*_en` (más simple que tabla de traducciones para operador único).
- Nombres de tabla en singular y snake_case.

### Enums de PostgreSQL

```sql
CREATE TYPE user_role AS ENUM ('admin', 'staff', 'guide');
CREATE TYPE tour_status AS ENUM ('active', 'archived');
CREATE TYPE ticket_type AS ENUM ('adult', 'child', 'student');
CREATE TYPE currency AS ENUM ('USD', 'CRC');
```

### RLS

- Todas las tablas tienen RLS habilitado.
- Política base: cualquier usuario autenticado puede hacer `SELECT`.
- Escritura (`INSERT`, `UPDATE`, `DELETE`) en `tours`, `tour_pricing`, `tour_schedules`: solo rol `admin`.
- El rol del usuario se lee desde `auth.jwt() -> 'user_role'` (claim custom en el JWT de Supabase, seteado en `users.role`).

### Trigger `updated_at`

Una función compartida `trigger_set_updated_at()` se aplica a todas las tablas con `updated_at`.

## 6. Modelo de datos

### `users`

Usuarios internos del sistema (admin, staff, guías). No hay tabla de clientes — los turistas son anónimos y sus datos viajan en `bookings`.

```sql
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE NOT NULL,
  role        user_role NOT NULL DEFAULT 'staff',
  full_name   text NOT NULL,
  phone       text,                          -- NOT NULL cuando role = 'guide' (ver CHECK constraint)
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT guide_requires_phone CHECK (role != 'guide' OR phone IS NOT NULL)
);
```

Índices: `email` (ya cubierto por UNIQUE). `role` no se indexa (baja cardinalidad, se usa poco en queries de tabla completa).

RLS:

- `SELECT`: cualquier usuario autenticado.
- `INSERT/UPDATE/DELETE`: solo `admin`.
- Un usuario puede leer y actualizar su propio registro (para perfil).

### `tours`

Definición de cada tour ofrecido. No incluye fechas ni capacidad por instancia — eso va en `tour_schedules` y `tour_instances`.

```sql
CREATE TABLE tours (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text UNIQUE NOT NULL,        -- para URLs: /tours/cerro-chompipe
  name_es             text NOT NULL,
  name_en             text NOT NULL,
  description_es      text NOT NULL,
  description_en      text NOT NULL,
  difficulty          text NOT NULL CHECK (difficulty IN ('easy', 'moderate', 'hard')),
  duration_minutes    integer NOT NULL CHECK (duration_minutes > 0),
  meeting_point_es    text NOT NULL,
  meeting_point_en    text NOT NULL,
  includes_es         text NOT NULL,               -- texto libre o markdown
  includes_en         text NOT NULL,
  min_participants    integer NOT NULL DEFAULT 1 CHECK (min_participants >= 1),
  max_capacity        integer NOT NULL CHECK (max_capacity >= min_participants),
  cover_image_url     text,                        -- URL externa, opcional en dev
  status              tour_status NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
```

Índices: `slug` (cubierto por UNIQUE), `status` (para filtrar tours activos).

Nota: `difficulty` como CHECK en lugar de enum propio — es un atributo de presentación, puede ampliarse sin migración de enum.

### `tour_pricing`

Precio por tipo de ticket para un tour. Permite precios diferenciados y temporadas, pero en el MVP se usará una sola entrada por tipo.

```sql
CREATE TABLE tour_pricing (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id       uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  ticket_type   ticket_type NOT NULL,
  price_usd     numeric(10, 2) NOT NULL CHECK (price_usd >= 0),
  season_label  text,                              -- ej: 'alta', 'baja' (opcional)
  valid_from    date,                              -- NULL = siempre válido
  valid_until   date,                              -- NULL = siempre válido
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_season_range CHECK (
    (valid_from IS NULL AND valid_until IS NULL)
    OR (valid_from IS NOT NULL AND valid_until IS NOT NULL AND valid_from < valid_until)
  ),
  CONSTRAINT season_label_required_with_dates CHECK (
    (valid_from IS NULL) OR (season_label IS NOT NULL)
  )
);
```

Índices: `(tour_id, ticket_type, active)` — query más frecuente al calcular precio de un checkout.

Nota: precio en CRC no se almacena; si el cliente necesita mostrarlo, se convierte al momento de la presentación. Evita inconsistencias por tipo de cambio.

**Precios por temporada**: el campo `season_label` es obligatorio cuando `valid_from`/`valid_until` están presentes. Al calcular el precio se elige la entrada activa cuyo rango de vigencia contiene la fecha del tour; si ninguna tiene vigencia, se usa la entrada sin rango. Nunca deben existir dos entradas activas del mismo `ticket_type` con rangos solapados — validación en aplicación (Etapa 5).

### `tour_schedules`

Patrones recurrentes de cuándo se opera un tour. Una instancia de Etapa 6 generará `tour_instances` a partir de estos registros.

```sql
CREATE TABLE tour_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id         uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  day_of_week     smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=domingo
  start_time      time NOT NULL,
  capacity        integer NOT NULL CHECK (capacity > 0),                   -- cupo por instancia
  valid_from      date NOT NULL DEFAULT current_date,
  valid_until     date,                                                     -- NULL = indefinido
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

Índices: `(tour_id, active)`, `(day_of_week, active)` — usados al generar instancias.

Constraint de unicidad: `UNIQUE (tour_id, day_of_week, start_time)` — previene duplicar la misma salida. Múltiples salidas el mismo día (ej: 6am y 2pm) son válidas y se representan como dos filas con distinto `start_time`.

## 7. Estados y transiciones

### Tour

```
active ──────────► archived
  ▲                    │
  └────────────────────┘  (puede reactivarse)
```

No se permite borrar un tour que tenga instancias con reservas activas (validación en aplicación, no en DB para evitar complejidad en esta etapa).

## 8. Casos borde y errores

- **Schedules solapados**: dos schedules en el mismo `day_of_week` y `start_time` para el mismo tour son posibles en DB pero inválidos en negocio. La validación va en la aplicación al crear schedules (Etapa 5).
- **Pricing sin vigencia + pricing con vigencia simultáneos**: se resuelve en la app eligiendo la entrada con vigencia más específica. La DB no lo impide.
- **Tour archivado con schedules activos**: los schedules quedan en DB pero el job de Etapa 6 ignorará tours no `active`.
- **`min_participants > max_capacity`**: imposible por CHECK constraint.
- **Precio 0**: permitido (tours gratis). La pasarela de pago manejará ese caso.

## 9. Impacto en otras áreas

- **`shared/constants/`**: se generan constantes de `user_role`, `ticket_type`, `tour_status`, `currency` para uso en web y worker sin strings literales.
- **Tipos generados**: `supabase gen types typescript` produce `web/types/supabase.ts`; el workflow de CI no regenera automáticamente — es responsabilidad del dev al hacer migraciones.
- **Worker** (Etapa 6): leerá `tour_schedules` para generar `tour_instances`. El schema debe estar estable antes.
- **i18n**: los campos `*_es` / `*_en` son la fuente de verdad. Los componentes eligen la columna según el locale activo.

## 10. Plan de tests

- **Tests de integración** contra Supabase local (Docker):
  - Migrar desde cero: `pnpm db:migrate` no lanza error.
  - Seed carga sin error.
  - Un usuario con rol `guide` no puede `UPDATE tours` (viola RLS).
  - Un usuario con rol `admin` puede crear y archivar un tour.
  - CHECK constraint rechaza `min_participants > max_capacity`.
  - `tour_pricing` con `valid_from > valid_until` es rechazado por constraint.
- **No hay unit tests** para este spec — el schema es la implementación; los tests son integración pura.

## 11. Plan de rollout

- Migraciones numeradas en `migrations/` con prefijo timestamp: `20260523000001_create_enums.sql`, `20260523000002_create_users.sql`, etc.
- El seed (`migrations/seed.sql`) es solo para desarrollo/staging. Nunca se aplica en producción automaticamente.
- Rollback: cada migración tiene su correspondiente `*_down.sql` comentado (no automatizado en esta etapa).
- Supabase CLI se usa para aplicar migraciones localmente; en producción se aplican manualmente hasta tener un pipeline de deploy formal.

## 12. Métricas de éxito

- `pnpm db:migrate` corre en <10s en una DB limpia.
- El typecheck de web y worker pasa con los tipos generados sin errores.
- El seed produce datos suficientes para completar Etapas 4–6 sin datos adicionales manuales.

## 13. Preguntas abiertas

- [x] **Pregunta**: ¿Los precios de los tours varían por temporada alta/baja o son fijos en el MVP? **Respuesta**: sí hay temporada — `valid_from`/`valid_until` en `tour_pricing` se usa desde el inicio.
- [x] **Pregunta**: ¿El tour tiene un solo horario fijo por día o puede tener múltiples salidas el mismo día? **Respuesta**: múltiples salidas — `UNIQUE(tour_id, day_of_week, start_time)` lo permite.
- [x] **Pregunta**: ¿Se necesita campo `phone` obligatorio para guías? **Respuesta**: sí — CHECK constraint `guide_requires_phone`.
