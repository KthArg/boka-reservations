# Changelog — 0021 Cierre de condiciones P1 de la auditoría final

Registro vivo de la implementación. Lo más reciente arriba.

## 2026-06-13 — Implementación completa (todos los checks verdes)

**P1-1 (PII en página de éxito):**

- `web/lib/format/mask-email.ts` + test (6 casos): `juan@gmail.com` → `j***@gmail.com`.
- `checkout/success/page.tsx`: deja de seleccionar `customer_name` y de renderizar el email
  completo; muestra `maskEmail(customer_email)`. Se reutiliza la clave `success-email`.

**P1-3 (consentimiento):**

- Migración `20260612000033_add_booking_consent.sql`: `consent_at` + `consent_version` (nullable).
- `shared/constants/legal.ts`: `PRIVACY_NOTICE_VERSION` (estampada server-side).
- `create.ts`: `initCheckout` recibe `consentAccepted` y persiste consent_at/version.
- `checkout-action.ts`: valida consent server-side antes de rate-limit/hold/booking.
- `CheckoutForm.tsx`: checkbox `required` con enlaces a /privacy y /terms (t.rich).
- `LegalPage` + páginas `/privacy` y `/terms` con placeholder (texto a cargo del cliente).
- i18n es/en: `consent-label`, namespace `legal`; eliminada `success-name`.

**Tests:** unit `checkout-action.test.ts` (rechazo sin consent, no invoca initCheckout) y
`mask-email.test.ts`; integración `checkout-consent.test.ts` (persistencia true/null). Callers de
`initCheckout` en `checkout-price-authority.test.ts` actualizados con `consentAccepted`.

**Decisión P1-1 render test:** no se automatiza el render de la página (el repo no tiene harness
para server components async de Next; sería frágil). La garantía la da el unit de `maskEmail` +
verificación manual. Spec sección 10 ajustada en consecuencia.

**Gotcha encontrado:** `web/types/database.ts` está **curado a mano** (uniones narrow como
`locale: 'es' | 'en'`, `status` unions). `pnpm db:types` regenera output crudo que pierde esas
uniones y rompe el typecheck de código no relacionado (p. ej. `guides/assign-action.ts`). Solución:
no usar `db:types` a ciegas; agregar las columnas nuevas a mano sobre el archivo curado.

**Checks:** typecheck OK · lint 0 errores · web 147 unit + 157 integration · worker 64 + 16.

## 2026-06-13 — Arranque de implementación

- Spec aprobado (estado `approved`). Rama `fix/0021-cierre-p1-auditoria-council` creada desde
  `fix/0020-...` (stacked: 0020 aún no está mergeado a `dev` y la migración 0033 asume la 0032).
- Commits previos en la rama: council infra (`chore`), reporte de auditoría (`docs`), spec (`docs`).
- Decisiones de las preguntas abiertas (confirmadas por el usuario):
  - Páginas legales: rutas in-repo con placeholder (`/privacy`, `/terms`).
  - PII en página de éxito: **email enmascarado** (no se renderiza el nombre ni el email completo).
  - Consentimiento: se guarda `consent_at` **y** `consent_version`.
- Nota de implementación: se reutiliza la clave i18n existente `success-email`
  ("Confirmación enviada a:") para el email enmascarado y se elimina `success-name`, en lugar de
  agregar `success-email-sent`. Queda dentro de lo que el spec permitía ("se elimina si se usa
  solo...") y evita una clave nueva redundante.
