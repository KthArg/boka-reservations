# 0047 — Dos tours fijos: diurno y nocturno

- **Estado**: approved
- **Autor**: Kenneth (con Claude Code)
- **Creado**: 2026-10-13
- **Última actualización**: 2026-10-13
- **Rama**: feat/0047-dos-tours-fijos
- **PR**: (pendiente)

## 1. Contexto y motivación

Hoy el sistema trata los tours como un catálogo abierto: el admin crea, edita y archiva tantos tours como quiera, y el turista ve una grilla de tarjetas. El operador decidió que su oferta son exactamente dos productos: el **tour diurno** y el **tour nocturno**. No va a crear tours nuevos.

Con el catálogo abierto sobran piezas (crear, archivar, slug editable, grilla genérica) y falta lo que dos productos fijos permiten: un panel que lleve directo a cada tour y un sitio público diseñado alrededor del contraste día/noche, que ya es la identidad de la marca (spec 0042).

Afecta al admin y al staff (panel) y al turista (motor de reservas). El guía no nota cambios.

Decisiones del usuario (2026-10-13):

- Público: portada partida con los dos tours y una página propia por tour.
- Panel: los dos tours se editan y se pueden pausar; no se crean ni se archivan.
- El tour de prueba `hola` de producción se archiva; los dos tours nuevos nacen sin horarios ni precios.
- 2026-10-13, antes de aplicar en producción: el tour de prueba `hola` no se archiva, se borra entero con todos sus datos (salidas, apartados, reservas, pagos, reembolsos y avisos). Es una prueba y no hace falta conservar registro. La migración …061 lo hace por slug; cualquier otro tour que existiera se archiva como estaba previsto.
- Al aprobar (2026-10-13): los dos tours nacen `active` ("disponibles"), no en pausa. Todavía no se vende, así que no hay riesgo: sin horarios ni precios el sitio los muestra sin fechas reservables.

## 2. Objetivos

- Fijar en el sistema exactamente dos tours vendibles, uno diurno y uno nocturno, sin posibilidad de crear, borrar ni archivar tours desde el panel.
- Conservar para cada uno toda la administración actual: textos, foto, horarios con vigencia, precios por temporada, mínimo y cupo, momento del cobro.
- Permitir que el admin pause y reanude la venta de cada tour sin afectar las reservas ya hechas.
- Dar al turista una portada con los dos tours y una página dedicada a cada uno, con ambiente propio de día y de noche.

## 3. Fuera de alcance

- No cambia nada del flujo de dinero: apartado, cobro inmediato y diferido, mínimo, reembolsos y cancelaciones quedan igual. `create_hold_atomic` no se toca.
- No se restringen las horas de los horarios según el tour: el admin puede poner cualquier hora en cualquiera de los dos. El ambiente lo define el tour, no la hora.
- No se cargan los textos, fotos, horarios ni precios reales: los carga el admin en el panel después del deploy.
- No se rediseña el checkout (sigue claro por el widget de OnvoPay) ni las páginas `/booking/[token]`, salvo de dónde sale el turno (§5.6).
- No se borran los tours viejos ni su historial: quedan archivados y siguen saliendo en reportes y en el filtro de reservas.
- No se agregan sitemap, SEO ni analítica.
- No se cambian las plantillas de correo.

## 4. Historias de usuario

> Como admin, quiero entrar directo al tour diurno o al nocturno desde el menú, para administrarlos sin pasar por una lista.

- [ ] El menú del panel muestra dos entradas, "Tour diurno" y "Tour nocturno", en lugar de "Tours".
- [ ] Cada entrada abre el formulario de ese tour en `/dashboard/tours/day` y `/dashboard/tours/night`.
- [ ] `/dashboard/tours` redirige a `/dashboard/tours/day`. `/dashboard/tours/new` y `/dashboard/tours/<uuid>/edit` responden 404.
- [ ] El formulario conserva todas las secciones actuales menos el campo "slug".
- [ ] No existe en el panel ningún control para crear, borrar o archivar un tour.
- [ ] El staff ve las dos entradas y el formulario, pero guardar y pausar siguen siendo solo del admin (como hoy).

> Como admin, quiero pausar un tour, para dejar de venderlo por un tiempo sin cancelar lo ya reservado.

- [ ] El encabezado del formulario muestra el estado ("En venta" o "En pausa") y un botón "Pausar venta" o "Reanudar venta".
- [ ] Pausar pide confirmación y avisa que las reservas existentes siguen en pie.
- [ ] Con el tour en pausa, el turista no puede iniciar una reserva nueva de ese tour por ningún camino (portada, página del tour, URL directa del checkout).
- [ ] Las reservas existentes de un tour en pausa conservan todo su ciclo: cobro, recordatorios, cancelación, cambio de fecha, check-in.
- [ ] Reanudar falla con un mensaje claro si el tour no está completo para venderse (§5.3).
- [ ] Pausar y reanudar quedan en `audit_logs` (`tour.paused`, `tour.resumed`) con el actor.

> Como turista, quiero ver los dos tours de un vistazo y entrar al que me interesa, para reservar sin navegar un catálogo.

- [ ] `/{locale}/tours` muestra dos mitades: la diurna con tema claro y la nocturna con tema noche. Cada una muestra nombre, una línea descriptiva, duración, precio "desde" y un botón para ver fechas.
- [ ] En pantallas angostas las mitades se apilan (día arriba, noche abajo), sin scroll horizontal.
- [ ] Cada mitad lleva a `/{locale}/tours/day` o `/{locale}/tours/night`.
- [ ] La página de cada tour muestra lo que hoy muestra el detalle (descripción, incluye, no incluye, requisitos, punto de encuentro, precios, edades, calendario), con composición propia de su turno. La nocturna usa el tema noche completo.
- [ ] Un tour en pausa aparece en la portada y en su página solo con su nombre y el aviso "No disponible por ahora": sin descripción, precios, calendario ni botón de reserva. Así los textos provisionales nunca se muestran.
- [ ] Una mitad sin foto usa el fondo de su tema; no queda un hueco.
- [ ] `/{locale}/tours/<cualquier-otra-cosa>` responde 404.
- [ ] El encabezado del sitio enlaza a los dos tours.
- [ ] Todo funciona en español e inglés.

## 5. Diseño técnico

### 5.1 Identidad de los dos tours

La tabla `tours` gana la columna `kind` (`day` | `night`, nula para tours viejos), única entre las filas que la tienen. Los dos tours fijos son las dos filas con `kind` no nulo. Se identifican por `kind` en todas las rutas; el `slug` queda como dato heredado (`day` y `night`), sin edición y sin uso en rutas públicas.

Alternativa descartada: usar solo slugs fijos `day`/`night`. Un slug es texto libre editable; `kind` con índice único y disparador de inmutabilidad lo garantiza en la base.

Alternativa descartada: `kind` obligatorio y prohibir más de dos filas. Unos 37 archivos de test insertan tours directamente con `service_role`; con `kind` nulo siguen funcionando sin tocarlos y representan además los tours archivados viejos.

### 5.2 Estado "en pausa"

`tour_status` gana el valor `paused`. Estados de un tour fijo: `active` y `paused`. `archived` queda solo para tours viejos (`kind` nulo); un CHECK impide archivar un tour fijo.

Qué hace la pausa:

- La política de lectura de `anon` sobre `tours` pasa a `status IN ('active','paused')`, para que el sitio pueda mostrar el aviso.
- Las lecturas públicas que alimentan el calendario y el checkout exigen `status = 'active'`.
- Las acciones que crean el apartado, `submitCheckout` (inmediato) y `startDeferredCheckoutAction` (paso 1 del diferido), verifican en el servidor que el tour de la salida esté `active`; si no, devuelven el error "tour no disponible". El paso 2 del diferido (crea la reserva sobre un apartado ya existente) no repite esta verificación: quien ya tiene apartado termina. Como las tres comparten `isInstanceSellable`, la verificación va fuera de esa compuerta o con un parámetro que el paso 2 no activa.
- `create_hold_atomic` no mira el tour. Queda una carrera de milisegundos entre la verificación y el apartado; se acepta, igual que el apartado vivo de §8.
- Supuesto aceptado: `anon` puede leer por PostgREST las columnas de un tour en pausa y sus salidas `available`. Las políticas de precios, horarios y salidas ya no miraban el estado del tour.
- Supuesto aceptado: un admin conserva UPDATE sobre `tours` por PostgREST y podría cambiar `status` sin pasar por las acciones (sin auditoría ni precondición). El panel no lo ofrece.
- El worker no genera salidas nuevas para un tour en pausa (ya filtra `status = 'active'`).
- Nada más cambia: las salidas existentes siguen su curso (cobros, mínimo, cancelación automática de salidas vacías, avisos).

Alternativa descartada: reutilizar "archivar" como pausa. Archivar se bloquea si hay reservas vivas y cancela las salidas futuras; una pausa debe poder hacerse en cualquier momento y sin efectos sobre lo vendido.

### 5.3 Acciones del panel

- `updateTour` se conserva; deja de aceptar `slug` y al guardar redirige a `/dashboard/tours/<kind>`. Las acciones por `kind` resuelven el id y delegan en un núcleo por id, que es el que usan los tests con tours desechables.
- `createTour`, `archiveTour` y `reactivateTour` se eliminan, junto con `ArchiveTourButton`, la página `new` y la lista.
- Nuevas `pauseTour(kind)` y `resumeTour(kind)`: solo admin; cambian el estado, registran auditoría y revalidan el sitio. Devuelven `{ ok: true } | { ok: false; error }`.
- `resumeTour` exige que el tour quede realmente vendible: ficha publicada completa (el mismo criterio `isTourBookable` que usa el sitio: no incluye, requisitos, edades), al menos un horario activo vigente y un precio de adulto vigente. Si falta algo devuelve un código por faltante (`tour_resume_missing_info`, `tour_resume_missing_schedule`, `tour_resume_missing_price`) y el mensaje dice qué falta. No existe el estado "activo pero no reservable" por ficha incompleta.
- Se retiran con ellas: `slugExists`, `cleanupAndFail`, el campo slug del esquema y del formulario, y los códigos de error de crear, archivar y slug.
- Las políticas RLS de INSERT y DELETE sobre `tours` para `authenticated` se eliminan: ni un admin puede crear o borrar tours por PostgREST.

### 5.4 Sitio público

- `/{locale}/tours`: portada partida. Lee los dos tours fijos (`kind` no nulo, `active` o `paused`), siempre en orden día, noche. Mantiene el freno anti-scraping actual.
- `/{locale}/tours/[kind]`: página dedicada. El parámetro se valida contra `day` | `night`; otro valor es 404. Reemplaza a la ruta actual por slug.
- `/{locale}/tours/[kind]/checkout?instance=<uuid>`: mismo checkout de hoy, resuelto por `kind`. Con el tour en pausa muestra el aviso y un enlace a la portada.
- El enlace "volver al tour" de `checkout/cancel` usa el `kind` del tour de la reserva; si es nulo (tour viejo), lleva a la portada.
- Los componentes `TourGrid` y `TourCard` se reemplazan por los de la portada partida. `AvailabilityCalendar` recibe el `kind` en lugar del slug.
- La dirección visual (composición de cada mitad, motivos de sol y luna, movimiento, fotos) se trabaja en la implementación sobre los tokens del spec 0042, sin colores ni tipografías nuevas. Requisitos fijos: contraste AA en ambos temas, `prefers-reduced-motion` respetado, sin scroll horizontal desde 320 px.

### 5.5 Worker

`generate-tour-instances` pasa de correr una vez al día a una vez por hora (es un upsert idempotente). Así, al reanudar un tour o agregar un horario, las salidas aparecen en menos de una hora sin reiniciar el worker.

### 5.6 Turno de una salida

Hoy el turno (día/noche) se deriva de la hora de inicio. Para un tour fijo pasa a ser su `kind`; para un tour viejo se conserva la derivación por hora. Aplica donde hoy se muestra el turno: página del tour, checkout, `/booking/[token]`, calendario y bandeja de salidas del panel; la vista de la reserva y la consulta de la bandeja pasan a traer `tours.kind`. `shiftOfTour`, `getTourShift` y el valor `both` quedan sin uso y se borran.

## 6. Modelo de datos

Dos migraciones, porque Postgres no deja usar un valor de enum en la misma transacción que lo agrega.

**`20261013000060_tour_status_paused.sql`**

- `ALTER TYPE tour_status ADD VALUE 'paused'`.

**`20261013000061_dos_tours_fijos.sql`**

- **Tipo nuevo**: `tour_kind AS ENUM ('day','night')`.
- **Tabla `tours`**, alter:
  - `kind tour_kind NULL`.
  - Índice único parcial `tours_kind_unique ON tours (kind) WHERE kind IS NOT NULL`.
  - CHECK `tours_fixed_not_archived`: `kind IS NULL OR status <> 'archived'`. Un tour de `kind` nulo sí puede estar `paused` (lo usan los tests).
  - Disparador `tours_fixed_guard`: rechaza UPDATE que cambie `kind` o `slug` de una fila con `kind` no nulo, y rechaza su DELETE. Aplica a todos los roles.
- **Políticas y grants**: se eliminan `tours_insert_admin` y `tours_delete_admin` y se hace `REVOKE INSERT, DELETE ON public.tours FROM authenticated` (spec 0027: la exposición se controla por grants); `tours_select_anon` pasa a `status IN ('active','paused')`.
- **Datos**:
  - Tours existentes (`kind` nulo, `active`): se archivan con las mismas reglas de la acción actual. La migración aborta, nombrando el tour, si tiene en salidas futuras alguna reserva `pending_minimum`, `pending_payment` o `confirmed`, o un ciclo de cobro abierto (`minimum_charge_triggered_at` no nulo con `minimum_resolved_at` y `minimum_charge_closed_at` nulos). Si no, cancela solo las salidas `available` con `starts_at >= now()` y pone `archived`. Deja una fila `tour.archived` en `audit_logs` por tour, con actor de sistema.
  - Se insertan los dos tours fijos con `status = 'active'` (decisión del usuario al aprobar), slugs `day` y `night`, nombres "Tour diurno" / "Day tour" y "Tour nocturno" / "Night tour", textos provisionales, sin horarios ni precios. Idempotente (`ON CONFLICT (kind) WHERE kind IS NOT NULL DO NOTHING`).
- **Auditoría**: la red `audit_table_grants_to_public_roles()` y la de funciones se revisan si el disparador agrega una función nueva (función de disparador, sin EXECUTE para `anon`/`authenticated`).

`supabase/seed.sql`: en lugar de insertar dos tours de ejemplo por id literal, ubica los dos fijos por `kind`, los completa con contenido, horarios y precios de ejemplo y los deja `active`.

`web/types/database.ts` (a mano, sin `pnpm db:types`) y `shared/constants/enums.ts` (`TourStatus.Paused`, `TourKind`) se actualizan. El worker no importa `@shared` en runtime: sigue usando literales.

## 7. Estados y transiciones

Tour fijo (`kind` no nulo):

- `paused → active`: "Reanudar venta" (admin). Requiere el tour completo para venderse (§5.3).
- `active → paused`: "Pausar venta" (admin). Sin precondiciones.
- `archived`: prohibido por CHECK.

Tour viejo (`kind` nulo): queda `archived`; el panel no ofrece ninguna transición.

Sin cambios en las máquinas de reservas, pagos, salidas ni notificaciones.

## 8. Casos borde y errores

- **Turista con apartado vivo cuando el admin pausa**: puede terminar de pagar. El apartado ya existe y el pago no vuelve a consultar el estado del tour. Aceptado: es una ventana de minutos y la reserva es legítima.
- **Turista con la página del checkout abierta, sin apartado, cuando el admin pausa**: al enviar el formulario recibe "tour no disponible"; no se crea apartado ni cobro.
- **Tour en pausa con reservas futuras**: siguen su ciclo. Las salidas futuras sin reservas se cancelan solas 24 h antes (regla del 0045) y pueden aparecer en "Salidas sin guía"; es ruido aceptado.
- **Reanudar**: las salidas canceladas durante la pausa no se restauran; las que faltan dentro del horizonte se generan en la siguiente corrida horaria del worker. Hasta entonces el calendario puede verse incompleto.
- **Reanudar con el tour incompleto**: error `tour_resume_missing_*` con lo que falta; el tour sigue en pausa.
- **Tour activo que deja de estar completo** (el admin borra después su único precio u horario): no se pausa solo; el sitio lo muestra como hoy, sin fechas reservables.
- **Cambio de fecha en un tour en pausa**: el staff puede mover una reserva a otra salida existente del mismo tour. Es la única vía por la que una salida de un tour en pausa gana cupos. En una pausa larga los destinos se agotan, porque no se generan salidas nuevas y las vacías se cancelan a las 24 h.
- **Salida generada con menos de 24 h de antelación** (horario nuevo o reanudación): no entra en la ventana que resuelve el mínimo ni se cancela por vacía. Ya ocurría con la corrida diaria; la anticipación mínima para reservar (0041) sigue aplicando.
- **Los dos tours en pausa**: la portada muestra las dos mitades con el aviso; no hay estado vacío aparte.
- **Dos admins pausan o reanudan a la vez**: la actualización es condicional al estado de origen; el segundo no cambia nada y no duplica la auditoría.
- **Guardar el formulario de un tour en pausa**: permitido; es como se prepara antes de reanudar. `withdraw_schedule_instances` sigue corriendo al guardar.
- **URL vieja `/tours/<slug-viejo>`**: 404.
- **Lectura pública limitada por el freno anti-scraping**: se conserva el mensaje actual en portada y páginas.
- **Fila fija faltante** (base mal sembrada): la portada muestra solo la que exista y registra un error en Sentry; `/dashboard/tours/<kind>` responde 404.

## 9. Impacto en otras áreas

- **Panel**: menú, rutas de tours, formulario sin slug, botón de pausa. El filtro por tour de Reservas sigue listando todos los tours (incluidos los archivados) para consultar historial.
- **Emails**: sin cambios. Los enlaces a `/tours` siguen siendo válidos (la portada).
- **Worker**: frecuencia de `generate-tour-instances` (§5.5). Los demás jobs no leen el estado del tour.
- **Reportes**: sin cambios; los tours viejos siguen apareciendo en el histórico.
- **Pagos y reembolsos**: sin cambios de lógica. Las acciones de checkout suman una verificación previa al apartado.
- **i18n**: textos nuevos en `tours` (entradas del menú, estados, pausar/reanudar, confirmación, errores) y en `public` (portada, aviso de no disponible, enlaces del encabezado), en ES y EN. Se retiran las claves de crear, archivar, slug y `shift-both` si quedan sin uso.
- **Documentación**: `docs/lanzamiento-checklist.md` pasa de "cargar los tours reales" a "completar el diurno y el nocturno y reanudar la venta".

## 10. Plan de tests

Integración (base local):

- Esquema: `kind` único (segundo `day` falla); CHECK impide archivar un tour fijo; el disparador rechaza cambiar `kind`/`slug` y borrar un tour fijo, también con `service_role`; un tour con `kind` nulo se sigue pudiendo insertar y borrar con `service_role`.
- RLS: un admin autenticado no puede insertar ni borrar en `tours`; `anon` lee `active` y `paused`, no `archived`.
- `pauseTour` / `resumeTour`: solo admin; auditoría con actor; reanudar sin horario o sin precio falla; doble pausa concurrente no duplica auditoría.
- Checkout inmediato y diferido contra un tour en pausa: error, cero apartados, cero pagos.
- Una reserva `confirmed` de un tour que se pausa después se puede cancelar y reembolsar como siempre.
- `updateTour` por `kind`: ignora un `slug` enviado en el formulario.
- Lecturas públicas: la portada devuelve los dos en orden día, noche; por `kind` inexistente devuelve nulo.
- Worker: `generate-tour-instances` no genera para un tour en pausa y sí al reanudar.

- Paso 2 del diferido con el tour pausado entre el paso 1 y el 2: la reserva se crea.
- Grants: `authenticated` recibe 42501 al insertar o borrar en `tours` (`table-grants.test.ts`).

Aislamiento: los dos fijos son filas únicas compartidas por toda la suite. Solo los tests de `pauseTour`/`resumeTour` los tocan, y restauran su estado al terminar. El resto usa tours desechables de `kind` nulo: el checkout contra pausa con un tour `kind` nulo en `paused`, y `updateTour` a través del núcleo por id.

Tests que se reescriben o retiran, citando este spec: `tours.test.ts` (crear, archivar, slug duplicado), `deferred-archive.test.ts` y la parte de archivado de `tour-pricing-constraints.test.ts` (la acción desaparece), `tour-charge-timing-action.test.ts` y `tour-schedule-validity-action.test.ts` (dejan `createTour`: insertan el tour por `service_role` y prueban el núcleo de `updateTour`), `tour-shift.test.ts`, `shift.test.ts` y `calendar-departures.test.ts` (turno por `kind`), `db.test.ts:222`, `auth.test.ts:95-163` (depende del tour `cerro-chompipe` del seed; pasa a un tour propio), `table-grants.test.ts`.

Unitarios: turno por `kind` con respaldo por hora; validación del parámetro `kind` de la ruta.

Manual (en el PR): portada y páginas en ES y EN, claro y noche, a 320, 768 y 1280 px; pausar y reanudar; reserva completa de cada tour en sandbox.

## 11. Plan de rollout

- Sin feature flag.
- Dos PR a `dev`: (A) esquema, panel, pausa y rutas por `kind` con la interfaz pública mínima funcional; (B) portada partida y páginas dedicadas.
- Antes de mergear: `supabase db reset` local confirma que 061 puede usar `'paused'` al aplicarse en la misma corrida que 060 (no hay precedente de `ADD VALUE` en el repo).
- Producción, en este orden: respaldo previo (`backups/prod-<fecha>-pre-060`), migraciones 060 y 061, y recién después el merge a `main` (Vercel despliega solo y el web nuevo consulta `kind`); luego el worker. Después de la migración los dos tours quedan `active` con textos provisionales y sin fechas: el sitio los muestra sin nada reservable hasta que el admin cargue contenido, horarios y precios. `resumeTour` solo exige el tour completo al volver de una pausa. Producción sigue en modo prueba, así que no hay venta real interrumpida.
- Antes de migrar producción, verificar que `hola` no tenga reservas vivas en salidas futuras ni ciclos abiertos; si los tiene, cerrarlos desde el panel primero (la migración aborta si no).
- Reversión: no basta con revertir el deploy. El web viejo sobre la base nueva solo ve tours `active` por slug, no puede crear tours (sin política ni grant) y su botón "Archivar" falla sobre un fijo por el CHECK. Para volver al catálogo abierto hace falta además una migración que recree las políticas y grants de INSERT/DELETE y reactivar `hola` por SQL. El valor `paused` del enum no se puede quitar. Lo razonable ante un problema es corregir hacia adelante.

## 12. Métricas de éxito

- En producción existen exactamente dos tours con `kind` y ninguno más en estado `active` o `paused`.
- Cero errores de Sentry nuevos en las rutas `/tours` durante la primera semana.

## 13. Preguntas abiertas

- [ ] **Pregunta**: ¿Cuáles son los nombres comerciales, textos y fotos definitivos de cada tour? No bloquea la implementación (se cargan en el panel), sí el lanzamiento. **Dueño**: Kenneth **Antes de**: reanudar la venta en producción.
