# 0003 — Gestión de tours desde el panel admin

- **Estado**: draft
- **Autor**: KthArg
- **Creado**: 2026-05-22
- **Última actualización**: 2026-05-22
- **Rama**: feat/0003-gestion-tours-panel-admin
- **PR**: (sin asignar)

## 1. Contexto y motivación

El panel admin tiene autenticación funcional pero no expone ninguna funcionalidad de gestión del
negocio. Los tours son la entidad central del sistema: todo lo demás (reservas, disponibilidad,
guías) gira alrededor de ellos. Sin un CRUD de tours, el operador no puede cargar el catálogo de
sus servicios, y ninguna etapa posterior del roadmap puede avanzar.

Esta feature le da al administrador la capacidad de gestionar el catálogo completo: crear, editar,
archivar y configurar precios y horarios semanales de cada tour.

## 2. Objetivos

- Permitir que el admin cree un tour completo (información básica + precios + horarios) desde el
  panel, sin tocar la base de datos directamente.
- Permitir que el admin edite cualquier campo de un tour existente, incluyendo precios y horarios.
- Permitir que el admin archive un tour para sacarlo de circulación sin perder el historial.
- Garantizar integridad de precios: no pueden existir rangos de fechas solapados para el mismo tipo
  de ticket en el mismo tour.
- Garantizar integridad de horarios: no puede existir la misma combinación de (día de semana, hora
  de inicio) dos veces en el mismo tour.

## 3. Fuera de alcance

- Upload de imágenes de portada. La URL de imagen se ingresa manualmente como texto.
- Eliminar tours permanentemente (solo se archiva).
- Gestión de `tour_instances` (instancias para fechas concretas). Eso es Etapa 6.
- Vista de disponibilidad en tiempo real. Etapa 6.
- Gestión de guías asignados a tours. Etapa futura.
- Staff y guide no pueden crear ni editar tours; solo el admin.
- Filtros avanzados o búsqueda en el listado. La versión inicial lista todos los tours sin filtro.
- Preview del tour tal como lo vería un turista. Etapa 6 (portal público).

## 4. Historias de usuario

> Como admin, quiero ver la lista de tours con su estado y datos clave, para tener una vista general
> del catálogo.

Criterios de aceptación:

- [ ] `/admin/tours` lista todos los tours (activos y archivados).
- [ ] Cada fila muestra: nombre en español, estado (`active` / `archived`), duración, cantidad de
      horarios activos.
- [ ] Hay un botón o link visible para crear un nuevo tour.
- [ ] Cada fila tiene un link a la página de edición del tour.

> Como admin, quiero crear un nuevo tour con toda su información, para tenerlo listo en el catálogo.

Criterios de aceptación:

- [ ] `/admin/tours/new` muestra un formulario completo con secciones: información básica, precios,
      horarios.
- [ ] Al guardar, si hay errores de validación, se muestran junto al campo o sección afectada.
- [ ] El tour creado aparece en el listado inmediatamente.
- [ ] El slug se genera automáticamente desde `name_es` y puede editarse manualmente antes de
      guardar.
- [ ] Si el slug generado ya existe, se agrega un sufijo numérico automáticamente.

> Como admin, quiero editar un tour existente, para mantener la información actualizada.

Criterios de aceptación:

- [ ] `/admin/tours/[id]/edit` carga los datos actuales del tour, sus precios y sus horarios.
- [ ] Puedo editar todos los campos de información básica.
- [ ] Puedo agregar nuevas filas de pricing; cada fila tiene tipo de ticket, precio en USD, y
      opcionalmente un rango de fechas con etiqueta de temporada.
- [ ] Puedo desactivar una fila de pricing existente (no se borra, se marca `active=false`).
- [ ] Puedo agregar nuevos horarios; cada horario tiene día de semana, hora de inicio y capacidad.
- [ ] Puedo desactivar un horario existente (no se borra, se marca `active=false`).
- [ ] Los cambios se guardan correctamente sin perder relaciones existentes.

> Como admin, quiero archivar un tour que ya no está activo, para que deje de estar disponible sin
> perder el historial.

Criterios de aceptación:

- [ ] En la página de edición hay una acción visible de "Archivar tour".
- [ ] Al archivar, el `status` cambia a `archived`.
- [ ] Los tours archivados siguen apareciendo en el listado, con su estado claramente marcado.
- [ ] Hay una acción de "Reactivar" para tours archivados que revierte el `status` a `active`.

## 5. Diseño técnico

### Estructura de archivos

```
web/
  app/[locale]/(admin)/
    tours/
      page.tsx                       # listado de todos los tours
      new/
        page.tsx                     # formulario de creación
      [id]/
        edit/
          page.tsx                   # formulario de edición
  lib/
    tours/
      repository.ts                  # queries Supabase tipadas (server-side)
      validation.ts                  # reglas de negocio: overlap, slugify
      actions.ts                     # Server Actions exportadas
      types.ts                       # tipos del dominio (TourFormData, etc.)
  components/
    tours/
      TourForm.tsx                   # formulario compartido (crea y edita)
      PricingEditor.tsx              # sección de gestión de filas de tour_pricing
      ScheduleEditor.tsx             # sección de gestión de filas de tour_schedules
```

### Server Actions (`lib/tours/actions.ts`)

- `createTour(data: TourFormData)` → crea el tour, sus precios y sus horarios. Retorna
  `{ success: true, id: string }` o `{ success: false, errors: ValidationErrors }`.
- `updateTour(id: string, data: TourFormData)` → actualiza campos del tour; hace upsert de pricing
  y schedules (insert si es nuevo, update si tiene id existente, desactiva si se marca inactivo).
- `archiveTour(id: string)` → `UPDATE tours SET status='archived'`.
- `reactivateTour(id: string)` → `UPDATE tours SET status='active'`.

Todas las actions requieren rol `admin` (via `requireRole`); las que modifican datos se hacen desde
el servidor y el resultado se refleja vía `revalidatePath`.

### Repositorio (`lib/tours/repository.ts`)

- `listTours()` → todos los tours con count de schedules activos. Ordenados por `created_at DESC`.
- `getTourWithDetails(id: string)` → tour + pricing activos + schedules activos + pricing
  inactivos + schedules inactivos (para mostrar en el editor cuáles están desactivados).
- `slugExists(slug: string, excludeId?: string): Promise<boolean>` → verifica unicidad.

### Validación (`lib/tours/validation.ts`)

**Slugify**: convierte texto a kebab-case sin caracteres especiales ni tildes. Si el slug resultante
ya existe en DB (verificado via `slugExists`), agrega sufijo `-2`, `-3`, etc.

**Overlap de precios**: para el mismo `(tour_id, ticket_type)`, dos filas se solapan si:

- Ambas tienen `valid_from = null` (precio base sin temporada): solo puede existir una.
- Ambas tienen fechas y sus rangos se intersectan: inválido.
- Una tiene fechas y la otra no: válido (la con fechas prevalece en su rango; la sin fechas es
  fallback fuera de ese rango).

La validación corre en el Server Action antes de escribir a la DB. Si detecta conflicto, retorna
errores con los índices de las filas conflictivas para que el formulario los resalte.

### Formulario (`TourForm.tsx`)

Componente client-side con tres secciones:

1. **Información básica**: `name_es`, `name_en`, `description_es`, `description_en`, `difficulty`,
   `duration_minutes`, `meeting_point_es`, `meeting_point_en`, `includes_es`, `includes_en`,
   `min_participants`, `max_capacity`, `cover_image_url`, `slug`.

2. **Precios** (gestionado por `PricingEditor`): lista de filas de pricing. Cada fila tiene:
   `ticket_type`, `price_usd`, `season_label`, `valid_from`, `valid_until`, `active`. Botón para
   agregar fila. Filas existentes desactivables con checkbox.

3. **Horarios** (gestionado por `ScheduleEditor`): lista de horarios. Cada fila tiene:
   `day_of_week`, `start_time`, `capacity`, `valid_from`, `valid_until`, `active`. Botón para
   agregar fila. Filas existentes desactivables.

El formulario usa `useActionState` (React 19 / Next.js 16) para manejar el estado de la action y
mostrar errores inline por campo.

## 6. Modelo de datos

Sin cambios al schema. Las tablas `tours`, `tour_pricing` y `tour_schedules` ya existen con todas
las columnas necesarias. Los constraints del DB actúan como segunda línea de defensa después de la
validación en el Server Action.

Columnas relevantes que el formulario toca:

**tours**: `slug`, `name_es`, `name_en`, `description_es`, `description_en`, `difficulty`,
`duration_minutes`, `meeting_point_es`, `meeting_point_en`, `includes_es`, `includes_en`,
`min_participants`, `max_capacity`, `cover_image_url`, `status`.

**tour_pricing**: `tour_id`, `ticket_type`, `price_usd`, `season_label`, `valid_from`,
`valid_until`, `active`.

**tour_schedules**: `tour_id`, `day_of_week`, `start_time`, `capacity`, `valid_from`,
`valid_until`, `active`.

## 7. Estados y transiciones

Tours:

```
active ←→ archived
```

- `active → archived`: acción "Archivar".
- `archived → active`: acción "Reactivar".

`tour_pricing.active` y `tour_schedules.active` son flags simples sin máquina de estados propia;
se pueden activar o desactivar libremente desde el formulario.

## 8. Casos borde y errores

- **Slug duplicado**: mostrar error en el campo slug; el sistema sugiere un slug alternativo con
  sufijo numérico.
- **Overlap de precios**: mostrar error indicando cuáles filas se solapan, con referencia por índice
  para que el usuario identifique la fila en el editor.
- **Horario duplicado** (mismo `day_of_week` + `start_time` en el mismo tour): error antes de
  persistir. La constraint UNIQUE de DB también lo rechazaría, pero la validación en el Server
  Action da un mensaje más útil.
- **`max_capacity < min_participants`**: error de validación en el formulario.
- **Precio negativo**: error de validación (el CHECK de DB también lo captura).
- **`duration_minutes <= 0`**: error de validación.
- **Tour con reservas futuras archivado**: no bloquear el archivado. Las reservas existentes quedan
  intactas. El portal público (Etapa 6) solo mostrará tours con `status='active'`.
- **Error de formulario en sección no visible**: el formulario hace scroll automático a la primera
  sección con errores para que el usuario vea el problema.
- **ID inválido en `/admin/tours/[id]/edit`**: si el tour no existe, redirigir a `/admin/tours`
  con mensaje de error visible.
- **Precio sin `valid_from` y sin `valid_until` pero con `season_label`**: inválido (constraint
  `season_label_required_with_dates` ya lo maneja en DB; validar también en el formulario para
  mensaje de error claro).

## 9. Impacto en otras áreas

- Nuevos textos i18n en `locales/es.json` y `locales/en.json` para labels del formulario, mensajes
  de error y estados del tour.
- Sin impacto en el worker (no hay `tour_instances` aún).
- Sin impacto en emails.
- Sin impacto en el portal público (no existe todavía; es Etapa 6).
- El listado `/admin/tours` se convertirá en el punto de entrada para la gestión de instancias y
  disponibilidad en etapas posteriores.

## 10. Plan de tests

**Unit** (`lib/tours/validation.ts`):

- Dos rangos de fechas que se solapan → retorna error con índices de las filas conflictivas.
- Un rango con fechas y uno sin fechas (precio base) para el mismo tipo → válido.
- Dos precios sin fechas para el mismo tipo de ticket → retorna error.
- `slugify` convierte texto con tildes y caracteres especiales a kebab-case válido.
- `slugify` con texto ya kebab-case no lo modifica.

**Integración** (`tests/integration/tours.test.ts`):

- Admin puede crear tour completo con una fila de pricing y un horario.
- Crear tour con slug duplicado retorna error de validación.
- Crear tour con precios solapados retorna error de validación.
- Admin puede actualizar el nombre de un tour existente.
- Admin puede desactivar un pricing existente (queda en DB con `active=false`).
- Admin puede archivar un tour y reactivarlo.
- Staff autenticado no puede crear ni editar tours (RLS lo bloquea; test lo confirma).

**Manual** (describir en el PR):

- Recorrer flujo completo: crear tour → editar → archivar → reactivar.
- Intentar guardar formulario con campos obligatorios vacíos → ver errores por campo.
- Intentar crear precios con rangos solapados → ver error específico con referencia a las filas.
- Intentar crear horario duplicado → ver error.
- Navegar a `/admin/tours/uuid-inexistente/edit` → debe redirigir a `/admin/tours`.

## 11. Plan de rollout

- Sin feature flag.
- Sin migración de datos (el schema ya existe; el seed tiene datos de ejemplo).
- Reversible: el panel admin es solo para el operador. Si hay un bug crítico, no hay impacto en
  usuarios externos hasta que el portal público esté activo (Etapa 6).
- Sin variables de entorno nuevas.

## 12. Métricas de éxito

- El admin puede cargar el catálogo completo sin asistencia técnica en menos de 30 minutos.
- Cero errores de integridad de datos (overlaps, duplicados) detectados después de una semana de
  uso en desarrollo.

## 13. Preguntas abiertas

Ninguna.
