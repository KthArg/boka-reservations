# Changelog — 0042 Identidad visual Boka Verde

## 2026-09-30 — Implementación completa

**Hecho**:

- Tokens: `globals.css` reasigna los tokens existentes a la paleta oficial (hueso `#f4f1de`, tinta `#0d1f17`, bosque `#1b3b2b`, hoja `#4a7c59`, sol `#e9c46a`), confirmada con la imagen de paleta del cliente incluida en el zip. Tokens nuevos: `--color-on-primary`, `--color-surface-raised`, `--gutter`, `--max-width-wide` (1760 px), `--text-5xl`.
- Tema de noche: `.theme-night` redefine los mismos tokens; `.theme-page-night` + `:root:has()` pasa todo el documento a la noche (página de un tour nocturno).
- Fuentes: Gloock + Montserrat con `next/font` (autoalojadas); se retiraron Young Serif y Hanken Grotesk.
- Marca: logos redimensionados a 720 px en `web/public/brand/` (~11 KB cada uno, antes ~120 KB) y la rana sola para la barra colapsada del panel. Componente `BrandLogo` con alto y ancho explícitos (sin saltos de diseño).
- Día/noche: `lib/public/shift.ts` (puro); `listActiveTours` y `getTourShift` leen los horarios activos y vigentes (`valid_until` nulo o desde hoy); `toCalendarDepartures` agrega `shift` por salida. `ShiftBadge` en tarjetas, detalle y checkout; sol/luna en cada salida del calendario y en la tabla de Salidas del panel.
- Pantallas: encabezado translúcido con logo y píldoras; pie en verde noche con el logo mixto; listado con héroe (sol y luna animados) y grilla de 1 a 5 columnas; detalle con portada y título superpuesto, contenido + precios a la izquierda y calendario fijo a la derecha; checkout en tarjeta de 720 px; login dividido; panel con barra verde noche, ítem activo en amarillo y contenido sobre hueso. Botones primarios en píldora en todos los módulos.
- Animaciones solo CSS (`bv-rise`, `bv-fade`, `bv-line`, `bv-reveal` con `animation-timeline: view()` en `@supports`), apagadas con `prefers-reduced-motion`.

**Code review** (code-reviewer):

- Arreglado: el enlace del logo quedaba sin nombre accesible en la página de un tour de noche (`aria-label`); la etiqueta "Día y noche" tenía contraste de ~1.2:1 (ahora texto hueso sobre verde noche, con el sol detrás del ícono).
- Arreglado: colores fijos en módulos pasados a tokens de marca; un solo `crClockTime` para la hora de 24 h de Costa Rica.
- Documentado en el spec: los horarios futuros cuentan para la etiqueta, y etiqueta y calendario pueden diferir si se desactiva un horario con salidas ya generadas.

**Decisiones**:

- El checkout queda en tema claro aun para salidas nocturnas: el widget de OnvoPay no se adapta al tema oscuro. Muestra la etiqueta de turno.
- Los precios pasaron a la columna principal del detalle para equilibrar las columnas; el calendario queda solo en la columna fija.
- El héroe del listado reutiliza los textos existentes; no se agregó copy de marca.

**Tests**:

- `lib/public/shift.test.ts` (12), 3 casos nuevos en `calendar-departures.test.ts` y 2 de `crClockTime`. Suite unitaria: 61 archivos, 516 tests en verde; `tsc` y `eslint` sin errores.
- Integración `tour-shift.test.ts` (5): sin horarios, noche, mixto, inactivo no cuenta, vencido no cuenta y el que vence hoy sí. Pasa junto con `booking-cutoff.test.ts` (14 en total).
- Manual con Playwright (datos de prueba locales, revertidos después): listado, detalle de día y de noche, checkout nocturno, login, panel (reservas, salidas) y términos. Sin elementos fuera del ancho en 320 px ni en 2560 px en 11 pantallas.

**Pendiente**:

- No se pudo ver en navegador la página de reserva por enlace (`/booking/[token]`) ni la del guía: necesitan un token real. Heredan los tokens.
- Revisar en producción con fotos reales de los tours.
