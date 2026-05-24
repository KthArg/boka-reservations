# Changelog — 0004 Portal público de listado y detalle de tours

Spec: [0004-portal-publico-tours.md](./0004-portal-publico-tours.md)
Rama: feat/0004-portal-publico-tours

## 2026-05-24 16:38 — Implementación completa, lista para PR

**Hecho**:

- Migración `20260524000010_create_tour_instances.sql`: crea tabla `tour_instances` con índices y trigger `updated_at`, habilita RLS, agrega políticas anon SELECT en `tours`, `tour_pricing`, `tour_schedules`, y `tour_instances`.
- Tipos `web/types/database.ts` actualizados manualmente con `tour_instances` Row/Insert/Update.
- Enum `InstanceStatus` agregado a `shared/constants/enums.ts`.
- Worker `env.ts`: `ONVOPAY_SECRET_KEY` y `RESEND_API_KEY` marcados como opcionales (no los necesita el job de instancias).
- Lógica pura de fechas extraída a `worker/src/jobs/tour-instance-dates.ts` (función `buildInstanceDates`) para testearla sin dependencias de entorno.
- Job `worker/src/jobs/generate-tour-instances.ts`: dos queries tipadas (schedules + tours), genera instancias para los próximos 90 días, hace upsert idempotente con `ON CONFLICT (schedule_id, starts_at) DO NOTHING`.
- `worker/src/index.ts` actualizado para correr el job al inicio y cada 24h.
- Cliente anon en `web/lib/db/supabase-public.ts`.
- Repositorio público `web/lib/public/tours.ts` con `listActiveTours`, `getTourBySlug`, `getTourPricing`, `getUpcomingInstances`.
- i18n: namespace `public` agregado a `es.json` y `en.json`.
- Layout público `web/app/[locale]/(public)/layout.tsx` con header (logo + nav + locale switcher) y footer.
- Componente `LocaleSwitcher` (client component) en `web/components/public/LocaleSwitcher/`.
- Componentes públicos: `TourCard`, `TourGrid`, `AvailabilityCalendar`, `PriceList` en `web/components/public/`.
- Página `/` (`web/app/[locale]/page.tsx`) redirige a `/${locale}/tours`.
- Página `/tours` (`web/app/[locale]/(public)/tours/page.tsx`): grid de tours activos.
- Página `/tours/[slug]` (`web/app/[locale]/(public)/tours/[slug]/page.tsx`): detalle + calendario de disponibilidad. `notFound()` si el tour no existe o está archivado.
- `TourBasicInfoSection.tsx` refactorizado: `Field` extraído a `TourField.tsx` para cumplir el límite de 150 líneas.
- Tests unitarios del worker (`buildInstanceDates`): 5 casos verifican day_of_week, rango, `ends_at`, idempotencia.
- Tests de integración web (`public-portal.test.ts`): verifica anon RLS en tours e instancias, bloqueo de INSERT anon, idempotencia del upsert.

**Por qué / decisiones**:

- Se separó `buildInstanceDates` a un módulo puro sin imports de `env.ts`, para que los tests unitarios del worker no necesiten las variables de entorno de Supabase.
- El job usa dos queries separadas (schedules + tours) en lugar de un JOIN con `!inner`, porque el cliente Supabase TypeScript no infiere tipos en joins relacionales complejos → generaba `any` que rompía el linter.
- Se usó `redirect` de `next/navigation` (nativo) en el root page porque el `redirect` de `@/i18n/navigation` (creado con `createNavigation`) espera `{href, locale}` en vez de solo un string.
- Los tests de fechas del worker requieren conocer el offset UTC-6 de CR: `2026-05-23T00:00:00Z` en UTC es viernes a las 18:00 CR — los tests usan fechas UTC que corresponden a viernes CR.

**Pendiente**:

- Nada — feature lista para PR.
