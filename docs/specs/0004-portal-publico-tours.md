# 0004 — Portal público de listado y detalle de tours

- **Estado**: draft
- **Autor**: KthArg
- **Creado**: 2026-05-24
- **Última actualización**: 2026-05-24
- **Rama**: feat/0004-portal-publico-tours
- **PR**: —

## 1. Contexto y motivación

El panel admin de tours existe (spec 0003), pero los tours no tienen canal de cara al público. Un turista interesado en los tours de Boka Trails no tiene dónde ver qué tours existen, cuándo salen y cuánto cuestan.

Esta feature construye el portal público: la cara visible del producto. Es la entrada al funnel de reservas — sin portal, no hay checkout (que viene en specs 0005 y 0006).

El portal no requiere cuenta ni login. Cualquier visitante puede navegar, ver tours, y ver disponibilidad. La reserva en sí viene después.

## 2. Objetivos

- Permitir que cualquier visitante vea el grid de tours activos con nombre, imagen, dificultad, duración y precio base.
- Mostrar el detalle de cada tour con descripción completa, qué incluye, punto de encuentro, precios por tipo de ticket y calendario de fechas disponibles.
- Generar automáticamente instancias de tour para los próximos 90 días a partir de los horarios recurrentes semanales.
- Soportar ES y EN desde el primer día (el contenido de tours ya es bilingüe).

## 3. Fuera de alcance

- Reservas y pagos (spec 0006).
- Filtros avanzados por dificultad, precio, duración (solo fecha en esta etapa).
- Sistema de búsqueda full-text.
- Reseñas de usuarios.
- Cancelación o modificación de instancias desde el panel admin (spec futuro).
- Gestión manual de `tour_instances` desde el panel (el job las genera automáticamente).
- Mostrar instancias con `status = 'full'` o pasadas (el portal solo muestra disponibles y futuras).

## 4. Historias de usuario

> Como turista, quiero ver todos los tours disponibles en una página, para decidir cuál me interesa sin necesidad de crear una cuenta.

Criterios de aceptación:

- [ ] La página `/tours` muestra cards de todos los tours con `status = 'active'`.
- [ ] Cada card muestra: imagen de portada (o placeholder), nombre, dificultad, duración y precio mínimo.
- [ ] Un visitante no autenticado puede acceder sin ser redirigido a login.

> Como turista, quiero ver el detalle de un tour específico con su calendario de disponibilidad, para elegir cuándo quiero ir.

Criterios de aceptación:

- [ ] La página `/tours/[slug]` muestra nombre, descripción, qué incluye, punto de encuentro, precios por tipo de ticket y tabla de dificultad/duración.
- [ ] El calendario muestra las próximas fechas disponibles (instancias futuras con `status = 'available'`), agrupadas por mes.
- [ ] Si no hay instancias futuras, se muestra un mensaje apropiado.
- [ ] Un slug inexistente o un tour archivado devuelve 404.

> Como sistema, quiero generar instancias de tour para los próximos 90 días cada día, para que el calendario siempre tenga fechas disponibles sin intervención manual.

Criterios de aceptación:

- [ ] El job del worker corre una vez al día y genera instancias para los schedules activos de tours activos.
- [ ] Si una instancia para (schedule_id, starts_at) ya existe, no se duplica (idempotente).
- [ ] Instancias de schedules desactivados o tours archivados no se generan.
- [ ] Las instancias se generan hasta 90 días en el futuro desde la fecha de ejecución.

## 5. Diseño técnico

### RLS — nuevas políticas anon

Actualmente los tours no son legibles por usuarios anónimos. Hay que agregar políticas SELECT para anon en las tablas que el portal expone:

- `tours`: anon puede SELECT donde `status = 'active'`.
- `tour_pricing`: anon puede SELECT (la tabla no tiene datos sensibles).
- `tour_schedules`: anon puede SELECT donde `active = true`.
- `tour_instances`: anon puede SELECT donde `status = 'available'` AND `starts_at > NOW()`.

Estas políticas se agregan en una nueva migración.

### Nueva tabla: `tour_instances`

Registra cada ocurrencia concreta de un tour. Se genera desde `tour_schedules`.

```
tour_instances
  id              uuid        PK default gen_random_uuid()
  tour_id         uuid        FK tours(id) ON DELETE CASCADE NOT NULL
  schedule_id     uuid        FK tour_schedules(id) ON DELETE CASCADE NOT NULL
  starts_at       timestamptz NOT NULL
  ends_at         timestamptz NOT NULL  -- starts_at + tours.duration_minutes
  capacity_total  integer     NOT NULL CHECK > 0
  capacity_reserved integer   NOT NULL DEFAULT 0 CHECK >= 0
  status          text        NOT NULL DEFAULT 'available' CHECK IN ('available','full','cancelled')
  created_at      timestamptz DEFAULT NOW()
  updated_at      timestamptz DEFAULT NOW()

  UNIQUE (schedule_id, starts_at)  -- idempotencia del job
```

Índices:

- `(tour_id, starts_at)` — consultas de calendario por tour
- `(starts_at) WHERE status = 'available'` — portal filtra disponibles

RLS:

- `anon` puede SELECT donde `status = 'available'` AND `starts_at > NOW()`
- `authenticated` puede SELECT todas
- Solo `service_role` puede INSERT/UPDATE/DELETE (el job usa service_role)

### Worker job: `generate-tour-instances`

Corre una vez al día (o manualmente). Algoritmo:

1. Obtener todos los tours `active` con sus schedules `active`.
2. Para cada schedule, calcular las fechas de inicio de las próximas 90 días que corresponden al `day_of_week`.
3. Para cada fecha, construir `starts_at` combinando la fecha con `start_time` (en zona horaria de Costa Rica, `America/Costa_Rica`).
4. Calcular `ends_at = starts_at + interval '{duration_minutes} minutes'`.
5. Hacer upsert con `ON CONFLICT (schedule_id, starts_at) DO NOTHING`.

Se usa la zona horaria `America/Costa_Rica` (UTC-6, sin horario de verano) para convertir los horarios de schedule a timestamps absolutos.

### Portal público — pages

El portal usa el route group `(public)` con su propio layout (header con logo + selector de idioma, footer).

```
app/[locale]/
  (public)/
    layout.tsx          — header público, footer
    page.tsx            — landing o redirect a /tours
    tours/
      page.tsx          — grid de tours
      [slug]/
        page.tsx        — detalle + calendario
```

Las pages son Server Components. Usan el cliente Supabase anon (sin session) para leer datos.

### Componentes

```
components/public/
  TourCard/
    TourCard.tsx
    TourCard.module.css
  TourGrid/
    TourGrid.tsx
    TourGrid.module.css
  AvailabilityCalendar/
    AvailabilityCalendar.tsx
    AvailabilityCalendar.module.css
  PriceList/
    PriceList.tsx
    PriceList.module.css
```

`AvailabilityCalendar` recibe las instancias disponibles ya cargadas desde el server. Es un componente de presentación (no hace fetch propio). Muestra fechas agrupadas en lista (no un calendario mensual de tipo grid — eso es complejidad innecesaria en MVP).

### Precio mínimo en TourCard

El precio que se muestra en la card es el precio más bajo de `tour_pricing` activo para ese tour (ticket_type `adult`). Si no hay pricing, se omite el precio.

## 6. Modelo de datos

**Tabla nueva**: `tour_instances`

| Columna           | Tipo        | Notas                                                     |
| ----------------- | ----------- | --------------------------------------------------------- |
| id                | uuid        | PK, gen_random_uuid()                                     |
| tour_id           | uuid        | FK tours, NOT NULL                                        |
| schedule_id       | uuid        | FK tour_schedules, NOT NULL                               |
| starts_at         | timestamptz | NOT NULL                                                  |
| ends_at           | timestamptz | NOT NULL                                                  |
| capacity_total    | integer     | CHECK > 0                                                 |
| capacity_reserved | integer     | DEFAULT 0, CHECK >= 0                                     |
| status            | text        | 'available' \| 'full' \| 'cancelled', DEFAULT 'available' |

**Migración**: `20260524000010_create_tour_instances.sql`

**Políticas RLS nuevas** (misma migración):

- tours: `tours_select_anon` — `anon` puede SELECT WHERE `status = 'active'`
- tour_pricing: `tour_pricing_select_anon` — `anon` puede SELECT
- tour_schedules: `tour_schedules_select_anon` — `anon` puede SELECT WHERE `active = true`
- tour_instances: `tour_instances_select_anon` — `anon` puede SELECT WHERE `status = 'available'` AND `starts_at > NOW()`

## 7. Estados y transiciones

`tour_instances.status`:

```
available ──→ full         (cuando capacity_reserved = capacity_total, en spec 0005)
full ──→ available         (cuando un hold expira y libera cupo, en spec 0005)
available ──→ cancelled    (si el tour se archiva o el admin cancela la instancia)
```

En esta etapa solo se usa `available`. Las transiciones a `full` y de vuelta son responsabilidad del motor de disponibilidad (spec 0005).

## 8. Casos borde y errores

- **Tour archivado con instancias futuras**: las instancias futuras se marcan `cancelled` en una migración o trigger. En MVP, el admin archiva el tour y el job deja de generar nuevas. Las instancias pasadas permanecen para historial.
- **Schedule desactivado a mitad de camino**: el job solo genera instancias para schedules `active = true`. Las instancias ya generadas no se tocan.
- **Worker caído varios días**: al volver, el job llena los 90 días hacia adelante desde hoy. No genera instancias para fechas pasadas.
- **Zona horaria**: todos los `starts_at` se almacenan en UTC. La conversión desde `America/Costa_Rica` usa el nombre de zona (no el offset hardcodeado) para manejar correctamente el caso aunque la zona cambie.
- **Slug no encontrado**: `notFound()` de Next.js → 404.
- **Tour activo sin instancias futuras**: se muestra el detalle del tour con mensaje "No hay fechas disponibles próximamente".
- **Tour activo sin pricing**: se muestra sin precio en la card.

## 9. Impacto en otras áreas

- **Migraciones DB**: nueva tabla `tour_instances` + políticas RLS anon en 4 tablas.
- **Worker**: nuevo job `generate-tour-instances` (cron diario).
- **i18n**: nuevas claves para el portal público en ES y EN.
- **Admin (panel)**: sin cambios en esta etapa — el admin no gestiona instancias directamente aún.
- **Tipos Supabase**: el archivo `web/types/database.ts` necesita actualizarse para incluir `tour_instances`.

## 10. Plan de tests

- **Unit** (worker): función que calcula las fechas de instancias para un schedule dado un rango de días.
- **Integration** (worker): crear un tour con schedule, correr el job, verificar instancias generadas con starts_at correctos. Verificar idempotencia (correr dos veces = mismo resultado).
- **Integration** (web): verificar que anon puede leer tours y tour_instances vía cliente Supabase. Verificar que anon no puede INSERT.

## 11. Plan de rollout

- El job se corre manualmente una vez al hacer deploy para poblar instancias iniciales: `pnpm --filter worker exec generate-tour-instances`.
- No requiere feature flag.
- Reversible: borrar las filas de `tour_instances` y la tabla si algo falla.
- El seed de precios de tours existentes llega hasta Nov 2026. Antes de demos en 2027+ hay que agregar filas de pricing.

## 12. Métricas de éxito

- Las páginas `/tours` y `/tours/[slug]` cargan en menos de 500ms en desarrollo local.
- Los tours del seed aparecen en el portal sin necesidad de configuración extra.
- El job genera instancias correctamente para los schedules del seed.

## 13. Preguntas abiertas

- [ ] **Pregunta**: ¿La landing page `/` debe ser una hero page con CTA o redirigir directamente a `/tours`? **Dueño**: KthArg **Antes de**: inicio de implementación.
- [ ] **Pregunta**: ¿Se muestra precio en CRC además de USD, o solo USD en MVP? **Dueño**: KthArg **Antes de**: implementar TourCard.
