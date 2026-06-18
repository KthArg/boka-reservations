# 0027 — Grants de tabla explícitos para PostgREST (control manual de exposición)

- **Estado**: draft
- **Autor**: Kenneth
- **Creado**: 2026-06-18
- **Última actualización**: 2026-06-18
- **Rama**: feat/0027-grants-explicitos-tablas-postgrest (cuando aplique)
- **PR**: # (cuando aplique)

## Lectura obligatoria antes de implementar (contexto del código vivo)

Para que una sesión nueva y fría pueda implementar esto de 0 a 100 sin re-derivar nada:

- En Supabase, las tablas nuevas del esquema `public` reciben un **GRANT por defecto** a los roles
  `anon` y `authenticated` (lo gobierna el toggle del dashboard **"Automatically expose new
  tables"**, que maneja `ALTER DEFAULT PRIVILEGES`). PostgREST necesita ese GRANT de tabla para que
  una fila sea siquiera alcanzable; la **RLS filtra DENTRO de lo concedido**. Hoy el proyecto
  **depende de ese grant por defecto** para varias tablas (ver audit 5.1); por eso el toggle no se
  puede apagar sin romper la app.
- **Cómo distinguir quién toca cada tabla** (clave para no romper nada): `createSupabaseServerClient`
  = sesión **autenticada** (`web/lib/db/supabase-server.ts`) → sujeta a grant+RLS; `createSupabase
PublicClient` = **anon** (`web/lib/db/supabase-public.ts`) → idem; `createSupabaseServiceClient` =
  **service_role** (`web/lib/db/supabase-service.ts`) → **bypassa grants y RLS** (no le afecta ningún
  REVOKE). Las RPC `SECURITY DEFINER` corren como su owner. El audit 5.1 ya está **cerrado y
  verificado contra el código** (revisión 2026-06-18); no es "a confirmar".
- Patrón de referencia ya en el repo: la red de regresión **`audit_public_executable_functions()`**
  (migración `…031`) + su test `web/tests/integration/rpc-execute-grants.test.ts`, que aseguran que
  ninguna **función** quede ejecutable por `anon`/`authenticated` fuera de una allowlist. Este spec
  replica el patrón para **tablas**.
- Decisión de arquitectura previa análoga (mismo gotcha de Supabase, para funciones): tech-decisions,
  "Supabase — REVOKE EXECUTE … FROM PUBLIC NO cierra anon/authenticated".
- Gotcha de testing del proyecto: los tests de integración que leen con **service_role** NO detectan
  un grant faltante (service bypassa). Por eso la validación de este spec corre con el default ya
  revocado (5.4) y con clientes **autenticado/anon reales**, no solo service.

## 1. Contexto y motivación

Durante la preparación del cutover a producción se detectó que el modelo de seguridad de la base de
datos **depende del grant de tabla por defecto** que Supabase da a `anon`/`authenticated` sobre las
tablas nuevas de `public`. Varias tablas que la app lee/escribe con sesión autenticada **no tienen un
`GRANT` explícito** y solo son alcanzables porque el toggle **"Automatically expose new tables"** está
activo. Consecuencias:

1. **No se puede apagar ese toggle** (lo que el propio Supabase recomienda para control manual de
   acceso) sin romper la autenticación y el panel: `users` se lee con sesión autenticada en cada
   request para resolver el rol, y no tiene grant explícito.
2. **Tablas que deberían ser solo service_role** (`audit_logs`, `tour_holds`, `guide_access_tokens`,
   `booking_access_tokens`, `processed_webhook_events`, `rate_limits`) quedan **expuestas a
   `anon`/`authenticated`** por el default. Hoy las protege la RLS (o la ausencia de políticas), pero
   la exposición a nivel grant es innecesaria y va contra el menor privilegio que el proyecto ya
   aplica a las funciones `SECURITY DEFINER`.

Es una mejora de **hardening / defensa en profundidad**: hacer **explícito** todo el control de
exposición de tablas, para que el toggle quede en OFF y la postura de seguridad no dependa de un
default del proveedor.

## 2. Objetivos

- Conceder grants de tabla **explícitos** (verbos mínimos) a las tablas que la app toca vía PostgREST
  con `anon`/`authenticated`, eliminando la dependencia del grant por defecto.
- Revocar explícitamente de `anon`/`authenticated` las tablas que solo deben tocarse con
  `service_role`.
- Cortar la exposición automática de tablas futuras a nivel base de datos
  (`ALTER DEFAULT PRIVILEGES … REVOKE`), para que local refleje prod y toda tabla nueva exija declarar
  sus grants.
- Endurecer `anon` a **solo SELECT** en las tablas del portal (revocar INSERT/UPDATE/DELETE).
- Agregar una **red de regresión** (función de auditoría + test) que falle si una tabla queda
  alcanzable por `anon`/`authenticated` fuera de una allowlist explícita.
- Habilitar que el toggle **"Automatically expose new tables" = OFF** en prod sea seguro.

## 3. Fuera de alcance

- **No se modifican las políticas RLS** existentes ni su semántica. La RLS sigue siendo el filtro de
  filas; este spec solo toca grants de tabla (la alcanzabilidad).
- **No se cambia el código de la aplicación.** El audit ya verificó que ninguna lectura/escritura
  autenticada/anon queda sin cobertura tras los grants explícitos; no hace falta tocar TypeScript.
- **No se tocan los grants/REVOKE de funciones** (`EXECUTE`), ya cubiertos por 0018/0019.
- **No se construye la vista de auditoría del panel.** `audit_logs` queda service-only; si esa vista
  se construye en el futuro, ese spec re-concederá el SELECT que necesite (la RLS `audit_logs_select_panel`
  queda latente).
- No es el cutover en sí: deja la base lista para apagar el toggle; el apagado efectivo en prod es un
  paso del runbook.
- No migra datos ni cambia máquinas de estado.

## 4. Historias de usuario

> Como responsable del sistema, quiero que la exposición de cada tabla a los roles públicos de
> PostgREST sea explícita y versionada, para apagar la exposición automática de Supabase sin romper la
> app y sin depender de un default del proveedor.

Criterios de aceptación:

- [ ] Cada tabla que la app toca con `anon`/`authenticated` tiene un `GRANT` explícito (verbos
      mínimos) en la migración nueva.
- [ ] Cada tabla service-only tiene `REVOKE ALL … FROM anon, authenticated` explícito.
- [ ] `anon` solo conserva `SELECT` en las cuatro tablas del portal.
- [ ] `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated`
      aplicado.
- [ ] Existe `audit_table_grants_to_public_roles()` que devuelve `(tabla, rol, privilegio)` fuera de
      una allowlist explícita, y un test que exige **0 filas** (corriéndola vía service_role).
- [ ] Tras `supabase db reset`, **toda la suite pasa** (web + worker, unit + integración) y el
      **portal público, el checkout y el panel completo (incl. crear/editar/archivar un tour)**
      funcionan, verificado con Playwright.

## 5. Diseño técnico

### 5.1 Audit cerrado (verificado contra el código, 2026-06-18)

| Tabla                      | Cómo la toca la app                                                                                                                                             | Acción en la migración                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tours`                    | anon SELECT (portal); authenticated CRUD (`web/lib/tours/actions.ts`, cliente server)                                                                           | `GRANT SELECT TO anon`; `GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated`; `REVOKE INSERT,UPDATE,DELETE FROM anon`                                                                                                               |
| `tour_pricing`             | igual que tours (el CRUD hace upsert/delete)                                                                                                                    | igual que tours                                                                                                                                                                                                                        |
| `tour_schedules`           | igual que tours                                                                                                                                                 | igual que tours                                                                                                                                                                                                                        |
| `tour_instances`           | anon SELECT (portal); authenticated SELECT (panel + reports); las crea el worker (service)                                                                      | `GRANT SELECT TO anon, authenticated`; `REVOKE INSERT,UPDATE,DELETE FROM anon`                                                                                                                                                         |
| `bookings`                 | authenticated SELECT (panel + reports INVOKER); escrituras (check-in) por service                                                                               | `GRANT SELECT TO authenticated`                                                                                                                                                                                                        |
| `payments`                 | authenticated SELECT (embed del panel + reports); escrituras por service                                                                                        | `GRANT SELECT TO authenticated`                                                                                                                                                                                                        |
| `notifications`            | authenticated SELECT (panel); escrituras por service                                                                                                            | `GRANT SELECT TO authenticated`                                                                                                                                                                                                        |
| `refunds`                  | authenticated SELECT (detalle del panel + reports); escrituras por service                                                                                      | `GRANT SELECT TO authenticated`                                                                                                                                                                                                        |
| `users`                    | authenticated SELECT (`auth/server.ts`, `users/repository.ts`, `guides/repository.ts`) + self-update de perfil (full_name/phone/locale); CRUD admin por service | `GRANT SELECT TO authenticated` + `GRANT UPDATE (full_name, phone, locale) TO authenticated` (a nivel COLUMNA → `active`/`role`/`email` quedan fuera del alcance de authenticated, sin tocar RLS); anon sin grant (revocado en `…009`) |
| `tour_instance_guides`     | authenticated SELECT (salidas); asignación por service                                                                                                          | `GRANT SELECT TO authenticated`                                                                                                                                                                                                        |
| `audit_logs`               | **solo service_role** (`audit/log.ts`, export route); ninguna lectura autenticada hoy                                                                           | `REVOKE ALL FROM anon, authenticated`                                                                                                                                                                                                  |
| `tour_holds`               | **solo service_role** (`booking/availability.ts`, `checkout/cancel`) + RPC `create_hold_atomic`                                                                 | `REVOKE ALL FROM anon, authenticated`                                                                                                                                                                                                  |
| `guide_access_tokens`      | solo service_role                                                                                                                                               | `REVOKE ALL FROM anon, authenticated`                                                                                                                                                                                                  |
| `booking_access_tokens`    | solo service_role                                                                                                                                               | `REVOKE ALL FROM anon, authenticated`                                                                                                                                                                                                  |
| `processed_webhook_events` | solo service_role                                                                                                                                               | `REVOKE ALL FROM anon, authenticated`                                                                                                                                                                                                  |
| `rate_limits`              | solo service_role (vía RPC)                                                                                                                                     | `REVOKE ALL FROM anon, authenticated`                                                                                                                                                                                                  |

**Verbos: el único caso de escritura autenticada son las tablas de tours** (`tours`, `tour_pricing`,
`tour_schedules`) vía el CRUD del panel. Todas las demás escrituras (check-in en `bookings`,
asignación en `tour_instance_guides`, alta/baja en `users`, refunds, holds, pagos, audit) van por
**service_role** → esas tablas solo necesitan `SELECT` a authenticated.

**Dependencia de los reportes (no quitar estos SELECT):** las funciones `report_*` son `SECURITY
INVOKER` y corren con la sesión authenticated, haciendo SELECT sobre tablas base
(`20260606000022_report_functions_and_indexes.sql`): `report_revenue` → `payments, bookings,
tour_instances, tours, refunds`; `report_occupancy` → `tour_instances, bookings, tours`;
`report_refunds_summary` → `refunds, bookings, tour_instances`. Todas quedan con `SELECT TO
authenticated` arriba; **no "limpiar" el SELECT de `payments`/`bookings` razonando que el panel no las
lee directo** — lo necesitan los reportes.

### 5.2 Migración de grants

Migración `supabase/migrations/<timestamp>_explicit_table_grants.sql` (sería la `…038`; confirmar el
timestamp siguiente a `…037` al implementar) que, en orden:

1. `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;` — espeja
   "auto-expose OFF" a nivel DB; local == prod, tablas futuras no se exponen solas.
2. `REVOKE ALL ON public.<tabla> FROM anon, authenticated;` para cada tabla service-only.
3. `GRANT <verbos mínimos> ON public.<tabla> TO <rol>;` para cada tabla de la app.
4. `REVOKE INSERT, UPDATE, DELETE ON <tablas del portal> FROM anon;` (anon solo SELECT).

Idempotente respecto de los grants explícitos ya existentes (reafirmarlos no daña). Debe quedar
**reproducible con `db reset`**: tras aplicarla, el estado de grants es el final deseado sin importar
el default del proyecto local.

### 5.3 Red de regresión

Función `public.audit_table_grants_to_public_roles()` (espejo de
`audit_public_executable_functions()`): recorre `information_schema.role_table_grants` (o equivalente)
y devuelve las ternas `(table_name, grantee, privilege_type)` donde `grantee IN ('anon','authenticated')`
sobre tablas de `public`, **excluyendo una allowlist explícita** de ternas intencionales. La allowlist
es exactamente:

- `anon`: `SELECT` sobre `tours`, `tour_pricing`, `tour_schedules`, `tour_instances`.
- `authenticated`: `SELECT,INSERT,UPDATE,DELETE` sobre `tours`, `tour_pricing`, `tour_schedules`;
  `SELECT` sobre `tour_instances`, `bookings`, `payments`, `notifications`, `refunds`, `users`,
  `tour_instance_guides`.

`SECURITY DEFINER` (corre como el owner para que `role_table_grants` vea todos los grants, no solo
los del invocador — igual que `audit_public_executable_functions` de la `…031`), solo lectura, con
`REVOKE EXECUTE … FROM anon, authenticated`. El test
(`web/tests/integration/table-grants.test.ts`, nuevo) la invoca **vía service_role** (como
`rpc-execute-grants.test.ts`) y exige 0 filas. Agregar una tabla pública nueva obliga a sumarla a la
allowlist (en la migración) o el test falla — el olvido se vuelve test rojo, no agujero silencioso.

### 5.4 Verificación de que la app aguanta "sin auto-expose"

Como la migración revoca el default localmente, `supabase db reset` + suite completa valida que los
grants explícitos **alcanzan**: si falta uno, el flujo correspondiente da `permission denied` (42501).
Más el barrido Playwright (sección 10).

## 6. Modelo de datos

Sin cambios de schema (columnas, índices, constraints). El cambio son **privilegios** (GRANT/REVOKE) +
`ALTER DEFAULT PRIVILEGES`, más una función de auditoría de solo lectura.

- **Migración**: `supabase/migrations/<timestamp>_explicit_table_grants.sql` (la `…038`).
- **Función nueva**: `public.audit_table_grants_to_public_roles()` (SECURITY DEFINER, solo lectura,
  `REVOKE EXECUTE … FROM anon, authenticated`).

## 7. Estados y transiciones

No aplica.

## 8. Casos borde y errores

- **Tabla de la app sin grant explícito** (olvido): tras `db reset` el flujo que la lee/escribe falla
  con 42501 → lo caza la suite de integración o el barrido Playwright (la validación corre con el
  default ya revocado).
- **Verbo faltante** (ej. se concede SELECT pero el CRUD de tours hace UPDATE): falla el flujo de
  escritura en tests/Playwright. Por eso 5.1 enumera verbos.
- **Tabla futura sin grant declarado**: cubierta por `ALTER DEFAULT PRIVILEGES … REVOKE` (no se
  expone) y por el test de regresión.
- **service_role**: no afectado por ningún REVOKE (bypassa grants y RLS); worker y route handlers con
  service client siguen igual.
- **GraphQL (`graphql_public`)**: ya bloqueado por `REVOKE USAGE ON SCHEMA graphql_public`; no se
  toca, no reintroducir exposición por ahí.

## 9. Impacto en otras áreas

- **Panel admin**: sin regresión si el audit es correcto; es lo que se valida (incl. CRUD de tours).
- **Portal público**: lecturas anon de tours/instancias/precios/horarios (SELECT) intactas.
- **Worker**: sin impacto (service_role).
- **Reportes**: dependen de SELECT-a-authenticated sobre tablas base (ver 5.1); se preservan.
- **Emails / i18n**: sin textos nuevos.
- **Runbook de cutover** (`docs/cutover-produccion.md`): actualizar la Fase 2 — con esta migración el
  toggle "Automatically expose new tables" puede quedar en **OFF** (hoy el runbook dice dejarlo ON por
  la dependencia que este spec elimina).
- **Memoria**: registrar la decisión en tech-decisions y actualizar el pre-production-checklist al
  implementar.

## 10. Plan de tests

- **Integración (nuevo)**: `table-grants.test.ts` — `audit_table_grants_to_public_roles()` devuelve 0
  filas fuera de la allowlist (invocada vía service_role).
- **Integración (regresión existente)**: toda la suite web + worker pasa tras `db reset` con la
  migración. Vigilar las que leen con sesión autenticada/anon real: `reports.test.ts`,
  `users-rls.test.ts`, `guide-departures.test.ts`, `bookings-admin.test.ts`, `public-portal.test.ts`
  (este ya prueba que anon NO inserta en `tour_instances`), `availability.test.ts`, `overbook.test.ts`.
  Confirmar que los nombres existen antes de citarlos en el PR.
- **Pentest puntual (anon)**: con la anon key, leer `users`, `audit_logs`, `tour_holds`,
  `guide_access_tokens`, `booking_access_tokens`, `processed_webhook_events`, `rate_limits` →
  `permission denied`; intentar INSERT/UPDATE/DELETE en las tablas del portal como anon → denegado.
- **Playwright (barrido de app completa, criterio del usuario)**: portal público (listar/ver tours,
  ES/EN); checkout hasta el widget OnvoPay; login admin; `/dashboard/bookings` (lista + detalle con
  sección de pagos/refunds); `/dashboard/departures` (con guía asignado); `/dashboard/users`;
  `/dashboard/reports` (los 4 reportes); **`/dashboard/tours`: crear, editar y archivar un tour**
  (valida los grants de escritura autenticada — el flujo que se rompería si falta un verbo). 0 errores
  de consola. Capturas en `.playwright-mcp/` (no en la raíz — regla "no junk in repo").

## 11. Plan de rollout

- **Migración** `…038` aditiva; sin migración de datos.
- **Local/CI**: `supabase db reset` aplica la cadena con el default ya revocado.
- **Producción (cutover)**: `supabase db push` y, en el dashboard, dejar **"Automatically expose new
  tables" = OFF** (ya seguro). El orden no importa: la migración también revoca el default a nivel DB.
- **Reversible**: ante problema, `GRANT` puntual de emergencia y/o `git revert` de la migración +
  reactivar el toggle. Bajo riesgo (privilegios, no datos).
- **Comunicación**: no requiere avisar a operadores (interno, sin efecto observable si está bien).

## 12. Métricas de éxito

- `audit_table_grants_to_public_roles()` devuelve **0 filas** fuera de la allowlist, en local y prod.
- La app funciona end-to-end **con auto-expose en OFF** (portal + checkout + panel incl. CRUD de
  tours), verificado por suite verde + barrido Playwright.
- Cero tablas service-only alcanzables por `anon`/`authenticated` (verificado por pentest anon).

## 13. Preguntas abiertas

Ninguna. El audit (5.1) quedó cerrado y verificado contra el código; las dos decisiones de producto
(disposición de `audit_logs` = service-only/REVOKE; inclusión del endurecimiento de verbos de anon y
del barrido Playwright de escritura de tours) fueron resueltas con el usuario el 2026-06-18.
