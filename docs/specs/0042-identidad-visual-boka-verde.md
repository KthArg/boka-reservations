# 0042 — Identidad visual Boka Verde en toda la aplicación

- **Estado**: implemented
- **Autor**: Claude (con decisiones del usuario del 2026-09-30)
- **Creado**: 2026-09-30
- **Última actualización**: 2026-10-01
- **Rama**: feat/0042-identidad-visual-boka-verde
- **PR**: (push directo a `main`, autorizado por el usuario el 2026-09-30)

Aprobado por el usuario de antemano el 2026-09-30 ("apenas tengas el spec terminado, apruébalo de manera inmediata"). Revisado por spec-reviewer el 2026-09-30; sus hallazgos (movimiento reducido con scroll-timeline, vigencia de horarios, alcance del tema de noche, fuentes, ubicación de tests, textos) están resueltos en este texto.

## 1. Contexto y motivación

El cliente tiene una landing page propia (maqueta "Boka Verde Landing", entregada como `Landing page Boca Verde.zip`) con una identidad muy marcada:

- Paleta: hueso `#f4f1de`, tinta verde casi negra `#0d1f17`, verde oscuro `#1b3b2b`, verde hoja `#4a7c59`, amarillo `#e9c46a`, arena `#eedcae`, texto secundario `#43564b`.
- Tipografía: **Gloock** (serif de display) para títulos y **Montserrat** para el cuerpo; etiquetas pequeñas en mayúsculas con mucho espaciado entre letras.
- Formas: botones tipo píldora, tarjetas de 20–28 px de radio, fotos a sangre, líneas finas como separadores.
- Un hilo narrativo **día → noche**: el sitio pasa de hueso a verde noche con sol, luna y luciérnagas, porque la empresa ofrece caminatas de día y de noche.
- Logos oficiales (blanco, hueso, negro, verde oscuro, mixto amarillo).

La plataforma de reservas (turista, panel del operador, guía) usa otra identidad ("bosque nuboso": Young Serif + Hanken Grotesk, verde OKLCH neutro, logo en texto). El turista salta de la landing al portal de reservas y siente que cambió de empresa. Además el portal desaprovecha pantalla: ancho máximo de 1180 px, portada del tour de 400 px, checkout de 560 px y un calendario de 320 px.

Este spec alinea toda la aplicación con la identidad de la landing, reacomoda los elementos para usar mejor el espacio y agrega la diferenciación visual día/noche según el horario del tour.

## 2. Objetivos

- Aplicar la paleta, tipografías, logos y formas de la landing en todas las pantallas (portal público, checkout, reserva por enlace, guía, autenticación y panel).
- Diferenciar visualmente los tours y salidas de día y de noche a partir de los horarios que ya existen, sin tocar el esquema.
- Reacomodar las pantallas principales (listado, detalle, checkout, login, panel) para que usen el ancho disponible y se vean bien desde 320 px hasta monitores de 2560 px.
- Agregar animaciones coherentes (entrada, hover, transición entre estados) solo con CSS, sin librerías nuevas y respetando `prefers-reduced-motion`.
- Mantener o mejorar el rendimiento: fuentes autoalojadas con `next/font`, logos optimizados y sin JavaScript adicional en el cliente.

## 3. Fuera de alcance

- No se construye la landing page en esta aplicación; la raíz `/[locale]` sigue redirigiendo a `/tours`.
- No se cambia ningún texto aprobado (términos, privacidad, textos del checkout), ni flujos, validaciones, precios o lógica de reservas.
- No se agregan campos al esquema (ni "categoría" ni "tipo día/noche"); la clasificación se deriva de los horarios.
- No se agrega modo oscuro por preferencia del sistema; el tema oscuro es exclusivo de los tours de noche.
- No se replican las animaciones pesadas de la landing (zoom de 300vh, canvas de luciérnagas, scroll pinning); se toma su lenguaje, no su coreografía.
- ~~No se cambian las plantillas de email.~~ Ampliado el 2026-10-01 a pedido del usuario: ver §5.5.3.
- No se agregan filtros de día/noche al listado de tours (queda para otro spec si se pide).

## 4. Historias de usuario

> Como turista que viene de la landing, quiero que el portal de reservas se vea como la misma marca, para confiar en que estoy reservando con Boka Verde.

- [ ] El encabezado público muestra el logo oficial (imagen), no el nombre en texto.
- [ ] Títulos en Gloock, cuerpo en Montserrat, paleta hueso/verde/amarillo en todas las pantallas públicas.
- [ ] Los botones de acción principal son píldoras con el estilo de la landing.

> Como turista, quiero distinguir de un vistazo si un tour es de día o de noche, para elegir el que me interesa.

- [ ] Cada tarjeta del listado muestra una etiqueta "Día", "Noche" o "Día y noche" según sus horarios activos.
- [ ] Las tarjetas de tours de noche usan el tema oscuro (verde noche con acentos amarillos).
- [ ] La página de un tour de noche usa el tema oscuro completo; la de un tour de día, el tema claro.
- [ ] En el calendario, cada salida lleva un ícono de sol o de luna según su hora de inicio.

> Como turista en el celular, quiero que las pantallas se lean y usen bien en cualquier tamaño.

- [ ] No hay scroll horizontal en ninguna pantalla pública, de autenticación o del panel entre 320 px y 2560 px.
- [ ] El detalle del tour pasa de una columna (móvil) a contenido + tarjeta de reserva fija al hacer scroll (escritorio).
- [ ] El listado de tours usa de 1 a 5 columnas según el ancho.

> Como operador, quiero que el panel tenga la misma identidad, para que la herramienta se sienta parte de la marca.

- [ ] La barra lateral usa el verde noche con el logo hueso; el contenido usa el fondo hueso.
- [ ] Las tablas, formularios y diálogos del panel heredan la nueva paleta sin perder legibilidad (contraste AA en texto).
- [ ] Ninguna acción del panel usa los popups del navegador (`window.confirm`, `window.alert`): las confirmaciones y los avisos son diálogos de la marca, con Cancelar enfocado en las acciones destructivas.

## 5. Diseño técnico

### 5.1 Tokens

Toda la UI ya consume tokens de `web/app/globals.css` (unas 1.280 referencias `var(--…)` en 41 CSS Modules). Se conservan los **nombres** de los tokens y se reasignan sus **valores** a la paleta de la landing, así todos los módulos heredan la identidad sin reescribirse uno por uno:

| Token                             | Valor nuevo                                             |
| --------------------------------- | ------------------------------------------------------- |
| `--color-surface`                 | hueso `#f4f1de`                                         |
| `--color-surface-alt` / `-sunken` | hueso ligeramente más oscuro (`#ece8d0`, `#e3dec3`)     |
| `--color-text`                    | tinta `#0d1f17`                                         |
| `--color-text-muted`              | `#43564b`                                               |
| `--color-primary` / `-dark`       | verde oscuro `#1b3b2b` / tinta `#0d1f17`                |
| `--color-primary-light` / `-tint` | verde hoja muy claro derivado de `#4a7c59`              |
| `--color-accent`                  | amarillo `#e9c46a` (con `-dark` para texto sobre claro) |
| `--color-border`                  | `rgba(13,31,23,.14)`                                    |

Se agregan tokens nuevos: `--color-leaf` (`#4a7c59`), `--color-sun` (`#e9c46a`), `--color-sand` (`#eedcae`), `--color-night` (`#0d1f17`), `--color-on-primary`, `--max-width-wide` (1760 px), espaciado fluido `--gutter` (`clamp(16px, 4vw, 64px)`) y la escala `--text-5xl`. Los semánticos (error, éxito, advertencia) se re-derivan para contrastar sobre hueso.

### 5.2 Tema de noche

Una clase global `.theme-night` (en `globals.css`) redefine los mismos tokens con la paleta nocturna de la landing: fondo `#0d1f17`/`#1b3b2b`, texto hueso, acento amarillo. Cualquier contenedor con esa clase se vuelve nocturno sin cambios en sus módulos. La página de un tour de noche lleva además `.theme-page-night`: `:root:has(.theme-page-night)` aplica los tokens nocturnos a todo el documento (fondo, encabezado y pie), así no quedan franjas hueso. Sin soporte de `:has()`, solo el artículo queda nocturno.

### 5.3 Clasificación día / noche

Una función pura en `web/lib/public/shift.ts`:

- `shiftOfTime("HH:MM[:SS]")` → `'night'` si la hora local de Costa Rica es ≥ 17:00 o < 05:00; si no, `'day'`. El corte de las 17:00 sale de la landing (la caminata nocturna sale a las 17:30).
- `shiftOfTour(startTimes[])` → `'day'`, `'night'`, `'both'` (horarios mixtos) o `null` (sin horarios).
- La hora de una salida concreta se obtiene de `starts_at` en la zona `America/Costa_Rica` (el mismo `BUSINESS_TIMEZONE` que ya usa el calendario).

Datos:

- `listActiveTours()` agrega una consulta a `tour_schedules` (`tour_id, start_time`, solo `active = true`, que es lo que la política `tour_schedules_select_anon` ya permite a `anon`) para los tours activos, filtrando también los horarios vencidos (`valid_until` nulo o mayor o igual a hoy en Costa Rica), y devuelve `shift` en cada tour. Es una consulta extra por página, en paralelo con la de precios.
- `getTourBySlug` no cambia; la página de detalle pide los horarios con una función nueva `getTourShift(tourId)`, con el mismo filtro de vigencia.
- `shift.ts` es puro (sin `server-only`): el calendario, que es componente de cliente, usa su tipo. El `shift` de cada salida se calcula en el servidor.
- `toCalendarDepartures` agrega `shift` a cada salida (derivado de `starts_at`).

Un tour `'both'` usa el tema claro con la etiqueta "Día y noche"; sus salidas nocturnas igual muestran la luna en el calendario.

### 5.4 Marca y fuentes

- `next/font/google` carga **Gloock** (`weight: 400`) y **Montserrat** (fuente variable, sin `weight`) autoalojadas con `display: swap`; se retiran Young Serif y Hanken Grotesk. No hay peticiones a Google en tiempo de ejecución.
- Los logos se copian a `web/public/brand/` redimensionados (ancho 800 px, PNG optimizado); los originales de 3931 px pesan ~120 KB cada uno. Se usan con `<img>` con `width`/`height` explícitos para no causar saltos de diseño.
- `favicon`: sin cambios en este spec.

### 5.5 Reacomodo por pantalla

- **Encabezado público**: barra transparente sobre hueso con desenfoque al hacer scroll, logo a la izquierda, navegación en píldoras y selector de idioma. En móvil se mantiene en una línea (logo + tours + idioma).
- **Listado de tours**: tarjeta de héroe en verde noche con sol y luna animados y los textos existentes, luego grilla `auto-fill` con pista de `clamp(280px, 17vw, 380px)` dentro de `--max-width-wide`. Tarjetas con foto 4:3, etiqueta día/noche sobre la foto; las de tours de noche en tema nocturno.
- **Detalle del tour**: portada a lo ancho del contenedor (altura `clamp(340px, 62vh, 680px)`) con el título superpuesto sobre un degradado; debajo, grilla de dos columnas `minmax(0, 1fr) minmax(340px, 440px)`: contenido y precios a la izquierda, calendario fijo a la derecha. En móvil (< 960 px), una columna con el calendario al final.
- **Checkout**: ancho hasta 720 px, tarjeta con encabezado del tour y fecha, etiqueta de turno (sol o luna) de la salida y controles de formulario con el estilo de la landing (bordes finos, radio 14 px, foco amarillo). El checkout queda siempre en tema claro, aun para salidas nocturnas: el widget de la pasarela tiene su propio estilo y no se adapta al tema de noche.
- **Éxito / cancelación / reserva por enlace / guía**: tarjetas centradas con el mismo lenguaje.
- **Autenticación**: pantalla dividida; panel de marca en verde noche con el logo hueso, sol y luna, y el formulario sobre hueso. En móvil (< 860 px), el panel de marca queda arriba y compacto.
- **Panel**: barra lateral verde noche, logo hueso (colapsada, solo la rana), ítem activo en amarillo; contenido sobre hueso con encabezados en Gloock; botones primarios en píldora. En Salidas, cada fila lleva el ícono de sol o de luna según su hora de inicio.

### 5.5.1 Diálogos (agregado el 2026-10-01 a pedido del usuario)

Los 13 componentes del panel que usaban `window.confirm` y `window.alert` pasan a `useDialogs()` (`web/components/dialogs/DialogProvider.tsx`), montado en el layout del panel:

- `confirm(mensaje, { tone })` devuelve `Promise<boolean>`; `alert(mensaje, { tone })` devuelve `Promise<void>`. Los textos no cambian; solo se agregan los botones `common.confirm` y `common.ok`.
- Usa `<dialog>` nativo (foco atrapado, Escape y fondo del navegador). Escape o clic en el fondo cuentan como cancelar.
- Tonos: `danger` para las confirmaciones irreversibles (archivar, desactivar, cancelar sin cobro, quitar guía, borrar datos personales, cerrar sin reembolso, cancelar una salida por mínimo), con el foco en Cancelar; `error`, `success` e `info` para los avisos.
- Los diálogos propios que ya existían (cancelar una salida, cancelar una reserva cobrada) toman la misma tarjeta, fondo y entrada.

### 5.5.2 Formularios y detalle del panel (agregado el 2026-10-01 a pedido del usuario)

Los formularios del panel estaban limitados a 480–1000 px y dejaban media pantalla vacía:

- **Tour (crear/editar)**: dos columnas desde 1200 px. A la izquierda, los textos en pares español | inglés, la información que publican los términos, precios y horarios. A la derecha, la "Ficha del tour" (foto, dificultad, duración, capacidades, slug), la política del mínimo y el momento del cobro. La barra de guardar queda fija al pie. Una columna en pantallas angostas; los pares pasan a uno debajo del otro bajo 640 px.
- **Configuración**: los datos del operador y las reglas de horas lado a lado desde 1280 px; los campos en una grilla de columnas.
- **Usuarios (crear/editar)**: tarjeta con los campos en dos o tres columnas.
- **Privacidad**: buscador en una sola fila (correo + botón).
- **Detalle de una reserva**: datos y notificaciones a la izquierda, correcciones y operaciones a la derecha; los datos en dos pares por fila desde 1600 px.

### 5.5.3 Correos (agregado el 2026-10-01 a pedido del usuario)

Los correos de Supabase Auth (invitación y contraseña) y los del worker (confirmación, recordatorio, cancelaciones, reembolsos, guía, cobro diferido) usaban el verde anterior. Pasan a la paleta de la marca sin cambiar ningún texto ni enlace:

- Fondo hueso, tarjeta clara con borde fino y radio de 20 px, banda superior verde noche con el logo hueso, títulos en Georgia (los clientes de correo no cargan Gloock), botón en píldora verde bosque y tabla de detalle sobre hueso.
- El logo se carga de `<sitio>/brand/logo-hueso.png` con texto alternativo "Boka Verde". En el worker, `wrapHtml` deja el nombre en texto y `withLegalFooter` lo cambia por el logo al enviar, porque es el paso que conoce la URL del sitio.
- Estilos del worker centralizados en `worker/src/notifications/templates/styles.ts`.
- Las plantillas de Supabase de producción se pegan a mano en el dashboard (Authentication → Email Templates), igual que en el spec 0038.

### 5.6 Animaciones

Solo CSS, en `globals.css` como utilidades reutilizables:

- `@keyframes rise` (opacidad + desplazamiento de 16 px) con escalonado por `--i` para listas (tarjetas del listado).
- Revelado de las secciones del detalle con `animation-timeline: view()` dentro de `@supports`; sin soporte, el contenido se muestra sin animar.
- Hover: zoom suave de la foto (1.05) en tarjetas, subrayado animado en enlaces de navegación, cambio de color de píldoras.
- Transición del día seleccionado del calendario.
- `prefers-reduced-motion: reduce` desactiva todo: la regla global acorta duraciones y, además, las clases de movimiento llevan `animation: none` explícito, porque una animación atada al scroll ignora la duración.

### 5.7 Rendimiento

- Cero dependencias nuevas; cero JavaScript nuevo en el cliente (salvo lo que ya usa el calendario).
- Las animaciones animan solo `opacity` y `transform`.
- Fotos de portada: se agrega `loading="lazy"` y `decoding="async"` en tarjetas; la portada del detalle usa `fetchpriority="high"`.

## 6. Modelo de datos

Sin cambios al modelo de datos. Se lee `tour_schedules.start_time` (columna existente, legible por `anon` para horarios activos).

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Horario activo pero vencido** (`valid_until` pasado): no cuenta para la etiqueta.
- **Horario que empieza en el futuro** (`valid_from` posterior a hoy): sí cuenta. El worker genera salidas por adelantado, así que un turno nuevo ya puede tener fechas a la venta en el calendario.
- **Etiqueta y calendario con fuentes distintas**: la etiqueta y el tema de la página salen de los horarios; el sol o la luna de cada salida, de su propia hora. Si se desactiva un horario que ya generó salidas, esas salidas conservan su ícono aunque la etiqueta del tour cambie. Es el comportamiento esperado: cada salida muestra su hora real.
- **Tour sin horarios activos**: `shift = null`; no se muestra etiqueta y se usa el tema claro.
- **Tour con horarios de día y de noche**: etiqueta "Día y noche", tema claro; el calendario marca cada salida con su propio ícono.
- **Falla la consulta de horarios en el listado**: se registra en consola y los tours se muestran sin etiqueta (no rompe la página).
- **Horario justo a las 17:00**: noche. **A las 04:59**: noche. **A las 05:00**: día.
- **Tour sin foto de portada**: el detalle muestra un héroe de color (verde noche o hueso según el tema) con el título, sin imagen.
- **Textos largos en inglés o nombres de tour largos**: los títulos usan `text-wrap: balance` y `overflow-wrap: anywhere` para no desbordar en 320 px.
- **Navegador sin `animation-timeline`**: el contenido aparece sin animación.
- **Página de error global** (`global-error`): se muestra fuera del layout raíz y sin las fuentes; se actualizan sus colores fijos a la paleta nueva con fuentes del sistema.
- **Impresión de textos legales**: se mantiene el `@media print` actual (sin encabezado ni pie).

## 9. Impacto en otras áreas

- Panel admin: solo visual; sin cambios de comportamiento.
- Emails: diseño nuevo, sin cambios de texto (§5.5.3).
- Worker: sin cambios.
- Reportes y métricas: sin cambios.
- Pagos, cancelaciones y reembolsos: sin cambios (el widget de OnvoPay mantiene su propio estilo).
- i18n: textos nuevos en `es.json` y `en.json`: `public.shift-day`, `public.shift-night`, `public.shift-both`. El héroe del listado reutiliza los textos existentes (`hero-title`, `tours-title`, `tours-subtitle`); no se inventa copy de marca. El texto alternativo del logo es el nombre de la marca, "Boka Verde", igual en ambos idiomas.

## 10. Plan de tests

- Unit (`web/lib/public/shift.test.ts`, junto al archivo como el resto de `lib/public`): `shiftOfTime` en los bordes (04:59, 05:00, 16:59, 17:00, 23:59, 00:00, con y sin segundos) y `shiftOfTour` (vacío, solo día, solo noche, mixto).
- Unit (`web/lib/public/calendar-departures.test.ts`, que ya fija `TZ=Asia/Tokyo`): `toCalendarDepartures` devuelve `shift` correcto para una salida a las 17:30 y otra a las 08:00 hora de Costa Rica.
- Suites existentes (`pnpm test`, `typecheck`, `lint`) en verde.
- Manual, documentado en el changelog: recorrer listado, detalle (día y noche), checkout, login y panel en 320, 390, 768, 1280 y 1920 px con Playwright, verificando que no hay scroll horizontal.

## 11. Plan de rollout

- Sin feature flag: es visual y reversible.
- Sin migración de datos.
- Push directo a `main` (autorizado por el usuario); Vercel despliega a producción.
- Reversión: `git revert` del commit del spec en `main` y `dev`.

## 12. Métricas de éxito

- El usuario y el cliente confirman que el portal se reconoce como la misma marca que la landing.
- Lighthouse móvil del listado y del detalle con Performance ≥ 90 y CLS < 0.05.
- Cero scroll horizontal en los anchos de prueba.

## 13. Preguntas abiertas

Ninguna.
