# Changelog — 0039 Calendario de fechas en la página del tour

## 2026-09-29 — Implementación completa

**Hecho**:

- `components/public/AvailabilityCalendar/`: el calendario pasa a ser un componente cliente dividido en `AvailabilityCalendar.tsx` (estado y navegación), `MonthGrid.tsx` (grilla de lunes a domingo), `DayDepartures.tsx` (horarios del día con lugares y "Reservar") y `calendar.ts` (lógica pura).
- `lib/public/calendar-departures.ts`: la página mapea en el servidor cada salida a `{ id, crDay, time, seatsLeft }`; `today` sale de `crDate()` en el servidor.
- Salidas llenas: el día con todas llenas se ve tachado ("Agotado") y no se puede elegir; una salida llena de un día con otras se lista como "Agotado" sin botón.
- `LOW_SEATS_THRESHOLD = 3` en `shared/constants/bookings.ts`: "¡Últimos N lugares!" en texto y color.
- i18n: claves `calendar-*` en `public`, con los nombres de meses y días de la semana (cortos y largos).
- Nota en `docs/lanzamiento-checklist.md` sobre el cobro diferido y el número de lugares.
- Tests unitarios de `calendar.ts` con `TZ=Asia/Tokyo` (12 casos).

**Decisiones**:

- Los nombres de meses y días vienen de los archivos de idioma y la hora se formatea en el servidor: con `Intl` en el cliente, el HTML del servidor (Node) y el del navegador podían no coincidir.
- Verificado en local con Playwright, en `es` escritorio y `en` celular: una salida a las 23:30 de Costa Rica aparece en su día, sin errores de hidratación en la consola.

**Pendiente**:

- Verificación manual en producción con lector de pantalla y con el navegador en otra zona horaria (plan de tests del spec).
