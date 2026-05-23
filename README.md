# Booking Platform — Sistema de reservas para tours

Sistema de reservas SaaS para un operador turístico (senderismo, observación de aves) en Costa Rica. Los turistas reservan sin necesidad de crear cuenta, los pagos se cobran en línea directo a la cuenta del operador, y el operador gestiona todo desde un panel administrativo.

## Tabla de contenidos

- [Visión general](#visión-general)
- [Stack](#stack)
- [Estructura del monorepo](#estructura-del-monorepo)
- [Requisitos previos](#requisitos-previos)
- [Setup local](#setup-local)
- [Variables de entorno](#variables-de-entorno)
- [Scripts disponibles](#scripts-disponibles)
- [Flujo de desarrollo](#flujo-de-desarrollo)
- [Deployment](#deployment)
- [Documentación adicional](#documentación-adicional)

## Visión general

El sistema atiende a tres tipos de usuarios:

- **Turistas**: reservan tours sin crear cuenta. Pagan con tarjeta o SINPE Móvil. Reciben confirmación, recordatorio 24h antes y comprobantes por email. Pueden ver, modificar o cancelar su reserva con un magic link enviado al correo.
- **Operador y su equipo**: el cliente (dueño del negocio) y sus empleados acceden a un panel admin para configurar tours, asignar guías a cada ejecución específica, ver reservas y reportes.
- **Guías**: profesionales asignados a tours individuales. Reciben notificación por email cuando son asignados. Acceden a su lista de tours del día por magic link.

El negocio:

- Mercado: Costa Rica, ticos y extranjeros (bilingüe ES/EN, multi-moneda CRC/USD).
- Volumen esperado primeros 12 meses: 100–1000 reservas/mes.
- Cupos por horario con mínimo 24h de anticipación.
- Política de cancelación: reembolso automático si se cancela con más de 24h, sin reembolso después.
- Modelo: SaaS para un cliente único (no marketplace). El cliente recibe los pagos directo en sus cuentas; el desarrollador es proveedor de software.

## Stack

| Capa | Tecnología | Por qué |
|---|---|---|
| Frontend + API | Next.js 15 (App Router) | Server components, server actions, deploy trivial en Vercel |
| Base de datos | Supabase (PostgreSQL) | Postgres administrado con RLS, auth para staff, storage para imágenes |
| Autenticación admin | Supabase Auth | Auth para usuarios internos (admin, staff, guías); turistas usan magic links sin cuenta |
| Pagos | OnvoPay | Pasarela costarricense con API moderna, tarjetas y SINPE Móvil, sin requerir entidad extranjera |
| Email | Resend + React Email | Confirmaciones, recordatorios, asignaciones; templates en React |
| Worker / cron | Node.js en Railway | Procesos largos: recordatorios, refunds, generación de tour_instances |
| Tipos compartidos | Zod | Schemas reutilizados en `web/` y `worker/` |

**Pagos post-MVP**: PayPal Business CR como pasarela secundaria para turistas extranjeros que prefieran ese método. La arquitectura de `lib/payments/adapters/` lo soporta desde el día uno; solo falta el adaptador concreto.

## Estructura del monorepo

```
booking-platform/
├── README.md
├── .claude/
│   ├── memory/                  # Memoria persistente del proyecto
│   └── skills/                  # Skills para Claude Code
├── docs/
│   ├── roadmap.md               # Plan de 0 a 100 con etapas y checkpoints
│   ├── claude-code-bootstrap-prompt.md  # Prompt para arrancar Claude Code
│   └── specs/                   # Specs de features (spec-driven)
├── web/                         # Next.js (deploy a Vercel)
│   ├── app/
│   │   ├── (public)/            # Portal de reservas (sin auth)
│   │   ├── (admin)/             # Panel para staff (con auth)
│   │   └── api/
│   ├── lib/
│   │   └── payments/
│   │       └── adapters/        # onvopay.ts ahora, paypal.ts post-MVP
│   └── package.json
├── worker/                      # Worker Node.js (deploy a Railway)
│   ├── jobs/
│   ├── index.ts
│   └── package.json
├── shared/                      # Tipos y schemas compartidos
│   ├── types.ts
│   ├── schemas.ts
│   ├── constants/               # Constantes por dominio (estados, errores, etc.)
│   └── package.json
└── migrations/                  # SQL migrations (Supabase / drizzle)
```

`web/` y `worker/` consumen `shared/` por path relativo. No se usa workspace tooling al inicio para mantener simplicidad.

## Requisitos previos

- Node.js 20 LTS o superior
- pnpm 9+
- Cuenta en Supabase, OnvoPay (la abre el cliente), Resend
- Cuenta en Railway (para el worker)

## Setup local

```bash
git clone <repo-url> booking-platform
cd booking-platform

# Instalar dependencias en cada paquete
cd web && pnpm install && cd ..
cd worker && pnpm install && cd ..

# Copiar y completar variables de entorno
cp web/.env.example web/.env.local
cp worker/.env.example worker/.env

# Aplicar migraciones a Supabase
pnpm --filter web db:migrate

# Levantar web app
cd web && pnpm dev
# Disponible en http://localhost:3000

# En otra terminal, levantar worker
cd worker && pnpm dev
```

## Variables de entorno

Ver `web/.env.example` y `worker/.env.example` para la lista completa. Las críticas:

| Variable | Dónde | Notas |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `web` | URL pública de Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `web` | Key pública (RLS la protege) |
| `SUPABASE_SERVICE_ROLE_KEY` | `web`, `worker` | **Nunca** exponer al cliente |
| `ONVOPAY_SECRET_KEY` | `web`, `worker` | Llave secreta de OnvoPay (`onvo_test_*` o `onvo_live_*`) |
| `ONVOPAY_WEBHOOK_SECRET` | `web` | Para verificar firmas de webhooks de OnvoPay |
| `RESEND_API_KEY` | `web`, `worker` | Envío de emails |
| `APP_URL` | `web`, `worker` | URL pública del sitio (para magic links) |

## Scripts disponibles

En `web/`:

- `pnpm dev` — servidor de desarrollo
- `pnpm build` — build de producción
- `pnpm lint` — ESLint
- `pnpm typecheck` — verificación de tipos sin emitir
- `pnpm test` — tests unitarios y de integración
- `pnpm db:migrate` — aplica migraciones pendientes
- `pnpm db:seed` — carga datos de ejemplo (solo dev)

En `worker/`:

- `pnpm dev` — worker en modo desarrollo
- `pnpm start` — producción
- `pnpm test` — tests

## Flujo de desarrollo

Trabajamos con metodología **feature-driven + spec-driven**.

Las reglas completas viven en `.claude/skills/` para que Claude Code las siga al colaborar. Resumen:

- **`project-memory`** — memoria persistente del proyecto, leída al inicio de cada sesión.
- **`feature-workflow`** — el ciclo completo desde idea hasta merge.
- **`spec-authoring`** — cómo escribir un spec antes de codificar.
- **`external-services-vetting`** — verificación obligatoria antes de incorporar servicios externos.
- **`commit-and-pr`** — convenciones de commits, ramas, PRs.
- **`codebase-conventions`** — estilo de código, organización, principios de DB.
- **`testing-practices`** — prácticas profundas y profesionales de testing.
- **`changelog-maintenance`** — changelog vivo por feature, actualizado al cerrar cada unidad de trabajo.

## Deployment

- **`web/`** se despliega a Vercel automáticamente en cada push a `main`.
- **`worker/`** se despliega a Railway automáticamente en cada push a `main`.
- Las migraciones de DB se aplican manualmente con review antes de hacer merge a `main`.

## Documentación adicional

- `docs/roadmap.md` — plan completo de 0 a 100 con etapas, entregables y checkpoints.
- `docs/specs/` — especificaciones de cada feature.
- `docs/claude-code-bootstrap-prompt.md` — prompt para arrancar Claude Code en una sesión nueva.
- `.claude/memory/` — memoria persistente del proyecto.
- `.claude/skills/` — guías de colaboración que Claude Code (y humanos) deben seguir.

## Licencia

Propietario. Ver `LICENSE`.
