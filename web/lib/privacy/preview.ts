import 'server-only';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { RefundStatus } from '@shared/constants/refunds';

// Vista previa del borrado a pedido (spec 0036): lo necesario para decidir, sin mostrar datos.

/** Reembolsos que todavía mueven dinero hacia la persona (mismo criterio que …050). */
const UNFINISHED_REFUND_STATUSES: readonly string[] = [
  RefundStatus.Pending,
  RefundStatus.Processing,
  RefundStatus.Failed,
  RefundStatus.AwaitingTransfer,
];

export type ErasurePreview = {
  total: number;
  byStatus: Record<string, number>;
  /** Reservas de tours que todavía no ocurrieron: se anonimizan igual. */
  upcoming: number;
  /** Con un reembolso sin terminar no se borra: la persona perdería el aviso de su dinero. */
  pendingRefunds: number;
};

type Row = {
  status: string;
  tour_instances: { starts_at: string } | null;
  refunds: { status: string }[] | null;
};

/**
 * `ilike` sin comodines: el correo se compara literal, sin mayúsculas. Se escapan `%`, `_` y `\`;
 * el `*` que PostgREST también trata como comodín no llega, porque Zod no lo acepta en un correo.
 */
function literalPattern(email: string): string {
  return email.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function loadErasurePreview(
  email: string,
  now: Date = new Date(),
): Promise<ErasurePreview> {
  const db = createSupabaseServiceClient();
  const { data, error } = await db
    .from('bookings')
    .select('status, tour_instances!inner(starts_at), refunds(status)')
    .ilike('customer_email', literalPattern(email));
  if (error) throw new Error(error.message);

  const rows = (data as unknown as Row[] | null) ?? [];
  const byStatus: Record<string, number> = {};
  let upcoming = 0;
  let pendingRefunds = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (row.tour_instances && new Date(row.tour_instances.starts_at) > now) upcoming += 1;
    pendingRefunds += (row.refunds ?? []).filter((r) =>
      UNFINISHED_REFUND_STATUSES.includes(r.status),
    ).length;
  }
  return { total: rows.length, byStatus, upcoming, pendingRefunds };
}
