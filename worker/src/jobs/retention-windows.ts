// Ventanas de retención (perfil B, spec 0022). Duplicadas acá — NO importadas de @shared —
// porque el worker no resuelve ese alias en runtime (mismo patrón que cleanup-rate-limits y
// reconcile-pending-payments). Los plazos definitivos los confirma el cliente con su contador
// (ver pre-production-checklist); ajustarlos es editar estas constantes.
//
// Módulo sin dependencias de entorno a propósito: la función es pura y se testea en unit sin
// cargar env. El job apply-retention la importa.
const PII_RETENTION_MONTHS = 18;
const UNPAID_BOOKING_RETENTION_DAYS = 90;
const NOTIFICATION_RETENTION_DAYS = 90;
const EXPIRED_TOKEN_GRACE_DAYS = 7;
// FINANCIAL_RECORD_RETENTION_YEARS = 5 queda definida en el spec pero sin job: la purga del
// registro anonimizado a 5 años está diferida (al lanzar no hay datos cercanos a esa edad).

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionCutoffs {
  piiCutoff: string;
  unpaidCutoff: string;
  tokenCutoff: string;
  notificationCutoff: string;
}

// Calcula los cutoffs (ISO) desde las ventanas. Recibe `now` para poder testearlo.
export function computeRetentionCutoffs(now: Date = new Date()): RetentionCutoffs {
  const pii = new Date(now);
  pii.setMonth(pii.getMonth() - PII_RETENTION_MONTHS);
  return {
    piiCutoff: pii.toISOString(),
    unpaidCutoff: new Date(now.getTime() - UNPAID_BOOKING_RETENTION_DAYS * DAY_MS).toISOString(),
    tokenCutoff: new Date(now.getTime() - EXPIRED_TOKEN_GRACE_DAYS * DAY_MS).toISOString(),
    notificationCutoff: new Date(
      now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS,
    ).toISOString(),
  };
}
