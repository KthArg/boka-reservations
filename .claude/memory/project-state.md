# Estado del proyecto

Última actualización: 2026-05-22 (Etapa 2 completa — setup técnico en rama, listo para merge)

## Modelo del proyecto

**SaaS de reservas para un operador turístico único** (no marketplace). Construido por un desarrollador para un cliente comprometido. El cliente recibe los pagos directo en sus cuentas; el desarrollador es proveedor de software.

## Etapa actual del roadmap

**Checkpoint 1** — Revisión del tooling antes de avanzar al desarrollo del producto.

## Specs implementados

Ninguno todavía.

## Spec en curso

Ninguno. El próximo spec a producir será `0001-modelo-de-datos-base` (corresponde a Etapa 3 del roadmap, después del Checkpoint 1).

## Próximas etapas pendientes

Ver `docs/roadmap.md` para el plan completo. En orden inmediato:

- Checkpoint 1 — Revisar tooling con el usuario. **← AHORA**
- Etapa 3 — Spec 0001 modelo de datos base.
- Etapa 4 — Spec 0002 autenticación de usuarios internos.

## Checkpoints pasados

- Etapa 0 ✓ (2026-05-22) — Cuentas externas listas: Supabase, OnvoPay, Resend, Vercel, Railway, GitHub.
- Etapa 1 ✓ (2026-05-22) — Scaffold inicial committeado en `main`.
- Etapa 2 ✓ (2026-05-22) — Setup técnico: Next.js 16, worker, shared, ESLint custom, Prettier, Husky, CI. En rama `chore/etapa2-setup-tecnico`, pendiente merge a main.

## Notas de estado

- Next.js 16.2.6 (no 15.x — la versión instalada es más nueva). Hay un AGENTS.md interno de Next.js 16 que advierte sobre breaking changes; se removió de web/ pero los docs están en node_modules/next/dist/docs/.
- Stack completo en web/: Next.js 16, vitest, zod. Worker: tsx + vitest + zod. Shared: tipos Zod derivados.
- ESLint enforza max-lines (150), no-magic-numbers (warn), no-restricted-syntax para strings de estado.
- Husky pre-commit: lint-staged corre ESLint --fix + Prettier en archivos staged.
- CI en .github/workflows/ci.yml: lint + typecheck + test en cada PR.
- **Pasarela única para MVP: OnvoPay**. PayPal Merchant para post-MVP.
- **Arquitectura de pagos preparada para múltiples pasarelas** desde el día uno (adapter pattern en `lib/payments/`).
