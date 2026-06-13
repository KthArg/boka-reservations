# Security Council — Auditoría final del proyecto

El **Security Council** es un cuerpo de auditoría de seguridad orientado a la **auditoría final** de `booking-platform` antes de su paso a producción con dinero y datos reales de turistas. No es una revisión intermedia de desarrollo: es la auditoría seria previa al lanzamiento.

## Diferencia con los subagentes de `.claude/agents/`

| | Subagentes (`.claude/agents/`) | Security Council (`.claude/council/`) |
|---|---|---|
| **Propósito** | Revisión continua durante el desarrollo de cada feature | Auditoría final integral antes de producción |
| **Disparo** | Triggers automáticos por tipo de tarea (al tocar pagos, schema, specs, etc.) | Invocación deliberada del coordinador para correr la auditoría |
| **Alcance** | Acotado a la unidad de trabajo en curso | Barrido completo y exhaustivo de todo el sistema |
| **Entregable** | Reporte de hallazgos sobre el diff/feature | Veredicto **go/no-go** por dominio y global, persistido en `docs/security-audits/` |
| **Documentado** | No exime de re-verificación | Re-verifica todo: nada se da por seguro por estar documentado o previamente revisado |

El council es **independiente** de los subagentes. Reutiliza el mismo conocimiento del proyecto (memoria, skills) pero con mentalidad de auditoría final, adversarial y exhaustiva.

## Composición

- **`security-council-coordinator`** — punto de entrada. Orquesta a los 5 auditores, consolida y deduplica hallazgos, resuelve contradicciones, emite el veredicto go/no-go y guarda el reporte.
- **`appsec-auditor`** — seguridad de aplicación (OWASP Top 10): inyección, XSS, CSRF, validación, etc. Prefijo `APPSEC`.
- **`access-control-auditor`** — autorización, RLS y aislamiento de datos entre roles. Prefijo `ACCESS`.
- **`payments-security-auditor`** — seguridad del flujo de dinero (ángulo adversarial). Prefijo `PAYSEC`.
- **`data-privacy-auditor`** — privacidad, PII y Ley 8968 de Costa Rica. Prefijo `PRIV`.
- **`infra-secrets-auditor`** — infraestructura, secretos y configuración de seguridad. Prefijo `INFRA`.

## Cómo se invoca

**Siempre a través del coordinador**, no a los auditores sueltos:

> "Corré la auditoría final del Security Council" → se invoca a `security-council-coordinator`.

El coordinador determina si es auditoría inicial o re-auditoría (según lo que haya en `docs/security-audits/`), invoca a los auditores que correspondan al scope, sintetiza el resultado y guarda el reporte.

## Dónde quedan los reportes

En `docs/security-audits/`:
- `YYYY-MM-DD-auditoria-final.md` — reporte de la auditoría inicial.
- `YYYY-MM-DD-reauditoria-N.md` — reportes de re-auditorías sucesivas.
- `GUIA-VERIFICACION-MANUAL.md` — lista de verificaciones que el council NO puede hacer solo (dashboards de servicios, pruebas con el sistema corriendo, pentesting, revisión legal).

## Reglas inviolables

1. **El council audita; NUNCA aplica correcciones.** Las correcciones las decide y ejecuta el usuario. Los auditores tienen herramientas de solo lectura; solo el coordinador escribe, y únicamente el reporte.
2. **Barrido completo:** el modo por defecto es revisar todo el código real, exhaustivamente. No muestrear.
3. **Nada se da por seguro por estar documentado:** changelogs, specs y revisiones previas de subagentes NO eximen de re-verificación.
4. **Honestidad sobre límites:** lo que requiere dashboards, sistema corriendo o pentesting se marca explícitamente como pendiente de verificación manual.

## Mapa de arquitectura real (para los auditores)

- **Migraciones:** `supabase/migrations/` (no `migrations/`, que solo tiene `.gitkeep`).
- **Pagos:** `web/lib/payments/` (`index.ts`, `types.ts`, `adapters/onvopay.ts`); webhook en `web/app/api/webhooks/onvopay/route.ts` (auth por header `x-webhook-secret`, no HMAC).
- **Refunds:** worker `worker/src/refunds/` + `worker/src/jobs/process-refunds.ts`; retry web en `web/lib/refunds/retry-action.ts`.
- **Reconciliación:** `worker/src/reconciliation/`.
- **Rate limiting / seguridad:** `web/lib/security/`, ruta `web/app/api/rate-limit/`.
- **Auth:** `web/lib/auth/` (`server.ts`, `actions.ts`, `safe-redirect.ts`, `invite-set-token.ts`).
- **Reportes / CSV:** `web/lib/reports/` (PII en exports).
- **Auditoría:** `web/lib/audit/log.ts`; migración `audit_logs_append_only`.
- **Notificaciones / email:** `worker/src/notifications/` (templates + adapters resend/mailpit).
- **Headers de seguridad:** `web/next.config.ts`. **Middleware:** `web/middleware.ts`.
- **Validación de env:** `web/lib/env.ts`, `worker/src/env.ts`.
- **Rutas:** `web/app/[locale]/(admin|auth|public)/`, `web/app/[locale]/guide/`, `web/app/[locale]/booking/`.
