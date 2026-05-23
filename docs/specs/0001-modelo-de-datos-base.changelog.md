# Changelog — 0001 Modelo de datos base

Spec: [0001-modelo-de-datos-base.md](./0001-modelo-de-datos-base.md)
Rama: feat/0001-modelo-de-datos-base

## 2026-05-23 — Implementación completa, lista para PR

**Hecho**:

- 6 migraciones SQL en `supabase/migrations/`: enums, trigger `updated_at`, `users`, `tours`, `tour_pricing`, `tour_schedules`.
- `supabase/seed.sql` con 3 usuarios internos, 2 tours, precios por temporada alta/baja, y schedules con múltiples salidas por día.
- `shared/constants/enums.ts` actualizado con `TourStatus`, `TicketType`, `TourDifficulty`.
- `shared/schemas.ts` reescrito para alinear con columnas reales de DB (`name_es`/`name_en`, `active`, `price_usd`, `ticket_type`, etc.).
- `web/types/database.ts` creado manualmente con la forma que genera `supabase gen types typescript`.
- `web/tests/integration/db.test.ts` con tests de constraints, CRUD básico y RLS anon.
- Scripts `db:migrate` y `db:seed` en root actualizados para usar Supabase CLI directamente.

**Por qué / decisiones**:

- Contenido bilingüe como columnas planas (`name_es`/`name_en`) en lugar de tabla de traducciones — más simple para operador único, evita joins en cada query.
- `difficulty` como CHECK constraint en lugar de enum PostgreSQL — es un atributo de presentación, puede ampliarse sin migración de tipo.
- Precio solo en USD (`price_usd numeric`) — CRC es referencial y fluctúa; convertir al momento de mostrar evita inconsistencias por tipo de cambio.
- `users.id` no ligado a `auth.users` aún — los IDs del seed son UUIDs fijos arbitrarios. En Etapa 4 se crearán los auth.users con esos mismos IDs mediante la API admin de Supabase.
- RLS lee `auth.jwt() ->> 'user_role'` — el claim se seteará en Etapa 4. Hasta entonces, los tests usan service_role para bypassear RLS.
- `web/types/database.ts` manual (no generado) porque Supabase no está linkeado aún. Se regenera con `supabase gen types typescript --local` una vez que Docker esté corriendo.

**Pendiente**:

- Nada — feature lista para PR.

**Notas para retomar**:

- Los tests de integración requieren Docker Desktop + `supabase start`. Sin Docker, `pnpm test:integration` falla con "connection refused".
- Para linkear el proyecto remoto: `supabase link --project-ref <id>` desde el root.
- Después de linkear, regenerar tipos: `supabase gen types typescript --local > web/types/database.ts` (o `--linked` para el remoto).
