import * as Sentry from '@sentry/node';

// Alerta de salidas con los cupos concentrados en pocas personas sin cobrar (spec 0048 §5.3): la
// señal de un acaparamiento con el cobro diferido. Cada 6 horas; el staff decide qué hacer.
// Umbrales locales: el worker no importa @shared en runtime.

/** Parte de la capacidad en reservas diferidas sin autorizar a partir de la cual se mira. */
export const HOARDING_SHARE = 0.5;
/** A lo sumo tantos emails distintos, o tantas tarjetas distintas, para alertar. */
export const HOARDING_MAX_IDENTITIES = 2;

export type HoardingCandidate = {
  instance_id: string;
  starts_at: string;
  tour_name: string;
  capacity: number;
  held_seats: number;
  distinct_emails: number;
  distinct_cards: number;
};

/** Sin PII: conteos y la salida, nunca emails ni tarjetas. */
export function alertHoarding(c: HoardingCandidate): void {
  const percent = Math.round((c.held_seats / c.capacity) * 100);
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setFingerprint(['deferred-hoarding', c.instance_id]);
    scope.setTag('instance_id', c.instance_id);
    scope.setExtras({
      starts_at: c.starts_at,
      tour: c.tour_name,
      capacity: c.capacity,
      held_seats: c.held_seats,
      percent,
      distinct_emails: c.distinct_emails,
      distinct_cards: c.distinct_cards,
    });
    Sentry.captureMessage(
      `[deferred-hoarding] ${c.tour_name} ${c.starts_at}: ${percent} % sin cobrar en ` +
        `${c.distinct_emails} email(s) / ${c.distinct_cards} tarjeta(s)`,
    );
  });
}

/** Lo mínimo del cliente de Supabase que usa el chequeo (testeable sin env). */
type RpcClient = {
  rpc(
    fn: 'deferred_hoarding_candidates',
    args: { p_share: number; p_max_identities: number },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function checkDeferredHoarding(db: RpcClient): Promise<void> {
  const { data, error } = await db.rpc('deferred_hoarding_candidates', {
    p_share: HOARDING_SHARE,
    p_max_identities: HOARDING_MAX_IDENTITIES,
  });
  if (error) throw new Error(`deferred_hoarding_candidates: ${error.message}`);
  for (const candidate of (data ?? []) as HoardingCandidate[]) alertHoarding(candidate);
}
