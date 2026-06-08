import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type { AuditAction, AuditActorType, AuditEntityType } from '@shared/constants/audit';

type ServiceClient = SupabaseClient<Database>;

type AuditEntry = {
  actorType: AuditActorType;
  actorId?: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: Json;
};

/**
 * Escribe una entrada en `audit_logs`. Best-effort: si falla, loggea y sigue.
 * La auditoría nunca debe revertir ni bloquear la operación que la origina
 * (spec 0011). Las cancelaciones se auditan dentro de la función DP atómica
 * `cancel_booking`; este helper cubre los eventos fuera de esa transacción
 * (ej. retry manual de un refund).
 */
export async function writeAuditLog(db: ServiceClient, entry: AuditEntry): Promise<void> {
  const { error } = await db.from('audit_logs').insert({
    actor_type: entry.actorType,
    actor_id: entry.actorId ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    metadata: entry.metadata ?? {},
  });
  if (error) {
    console.error('[audit] no se pudo registrar', entry.action, error.message);
  }
}
