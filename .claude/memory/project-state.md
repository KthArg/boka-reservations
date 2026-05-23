# Estado del proyecto

Última actualización: 2026-05-22 (primer commit — scaffold Etapa 1 completa)

## Modelo del proyecto

**SaaS de reservas para un operador turístico único** (no marketplace). Construido por un desarrollador para un cliente comprometido. El cliente recibe los pagos directo en sus cuentas; el desarrollador es proveedor de software.

## Etapa actual del roadmap

Etapa 2 — Setup técnico del monorepo (Next.js, worker, TypeScript, ESLint, CI).

## Specs implementados

Ninguno todavía.

## Spec en curso

Ninguno. El próximo spec a producir será `0001-modelo-de-datos-base` (corresponde a Etapa 3 del roadmap).

## Próximas etapas pendientes

Ver `docs/roadmap.md` para el plan completo. En orden inmediato:

- Etapa 2 — Setup técnico del monorepo (Next.js, worker, tooling, linters). **← EN CURSO**
- Etapa 3 — Spec 0001 modelo de datos base.
- Etapa 4 — Spec 0002 autenticación de usuarios internos.

## Checkpoints pasados

- Etapa 0 ✓ (2026-05-22) — Cuentas externas listas: Supabase, OnvoPay, Resend, Vercel, Railway, GitHub.
- Etapa 1 ✓ (2026-05-22) — Scaffold inicial committeado en `main`.

## Notas de estado

- El repo tiene el scaffold inicial committeado: README, roadmap, skills, memoria, template de spec, .gitignore, LICENSE, CONTRIBUTING.md, carpetas vacías con .gitkeep.
- Pendiente todo el setup técnico (instalar Next.js, worker, ESLint con reglas custom, CI, etc.).
- **Pasarela única para MVP: OnvoPay**. PayPal Merchant para post-MVP.
- **Arquitectura de pagos preparada para múltiples pasarelas** desde el día uno (adapter pattern en `lib/payments/`), aunque solo OnvoPay esté implementado en MVP.
