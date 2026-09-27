import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import { createOnvopayChargeClient, type OnvopayChargeClient } from '../charges/onvopay.js';
import { CycleAction, decideCycle, shouldForceResolve } from '../charges/departure-cycle.js';
import {
  fetchDeparture,
  fetchDepartureCandidates,
  type DepartureCandidate,
} from '../charges/departure-repository.js';
import {
  OpenOutcome,
  closeDepartureCharge,
  departureChargeDue,
  openDepartureCharge,
} from '../charges/departure-rpc.js';
import { authorizePending } from '../charges/departure-authorize.js';
import { captureAll, releaseAll } from '../charges/departure-settle.js';
import {
  RESOLUTION_MARGIN_MS,
  captureDeparture,
  cycleInput,
  forceResolve,
  releaseDeparture,
} from '../charges/departure-resolve.js';
import { alertCharge } from '../charges/alerts.js';

// Motor del cobro del mínimo (spec 0033). Cada minuto: abre el ciclo de las salidas que llegaron a
// su momento, autoriza sin capturar, y recién con los cupos autorizados a la vista captura todo o
// suelta todo. Soltar no cuesta nada; reembolsar un cobro sí, y OnvoPay no devuelve el costo
// (verificado en sandbox, 2026-09-23).

let isRunning = false;

export async function chargeDepartures(): Promise<void> {
  if (isRunning) {
    console.warn('[charge-departures] ciclo anterior en curso; se omite');
    return;
  }
  isRunning = true;
  try {
    await runCycle();
  } finally {
    isRunning = false;
  }
}

async function runCycle(): Promise<void> {
  if (!env.DEFERRED_CHARGE_ENABLED && !env.RELEASE_AUTHORIZATIONS_ONLY) return;
  if (!env.ONVOPAY_SECRET_KEY) {
    console.warn('[charge-departures] sin ONVOPAY_SECRET_KEY; se omite');
    return;
  }

  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const onvopay = createOnvopayChargeClient(env.ONVOPAY_SECRET_KEY, env.ONVOPAY_API_BASE_URL);
  const departures = await fetchDepartureCandidates(db, new Date().toISOString());

  for (const departure of departures) {
    try {
      await processDeparture(db, onvopay, departure, new Date());
    } catch (err) {
      // Una salida que falla no frena a las demás: el ciclo es por salida y se reintenta al minuto.
      console.error(
        `[charge-departures] ${departure.id}:`,
        err instanceof Error ? err.message : 'unknown',
      );
      alertCharge(
        '[charge-departures] error en el ciclo',
        'departure-cycle',
        departure.id,
        'error',
      );
    }
  }
}

async function processDeparture(
  db: SupabaseClient,
  onvopay: OnvopayChargeClient,
  departure: DepartureCandidate,
  now: Date,
): Promise<void> {
  // Modo de reversión (§11): soltar lo vivo y cerrar, sin cobrar nada.
  if (env.RELEASE_AUTHORIZATIONS_ONLY) {
    await releaseAll(db, onvopay, departure.id);
    if (departure.minimum_charge_triggered_at) await closeDepartureCharge(db, departure.id);
    return;
  }

  // Salida ya resuelta con reservas tardías: se cobran solas, sin decidir nada (§5.3, paso 5).
  if (departure.minimum_resolved_at !== null) {
    await authorizePending(db, onvopay, departure.id, now);
    await captureAll(db, onvopay, departure.id);
    return;
  }

  let current = departure;
  // El gate del disparo solo decide si ABRIR. Con el ciclo ya abierto no se vuelve a consultar:
  // si los cupos vendidos bajan, la respuesta pasaría a "no corresponde" y el job abandonaría la
  // salida con las autorizaciones vivas, sin soltarlas ni resolverla.
  if (current.minimum_charge_triggered_at === null) {
    if (!(await departureChargeDue(db, current.id))) return;
    const opened = await openDepartureCharge(db, current.id);
    if (opened === OpenOutcome.NotDue || opened === OpenOutcome.NotChargeable) return;
    // Abrir estampa plazo y foto nuevos: seguir con los datos viejos usaría el plazo anterior,
    // que en una reapertura ya está vencido.
    current = (await fetchDeparture(db, current.id)) ?? current;
  }

  let input = await cycleInput(db, current, now);
  // Con el plazo vencido no se autoriza nada más: el ciclo se está resolviendo y volver a
  // autorizar retendría plata en las tarjetas una y otra vez, cada minuto, sin cambiar nada.
  if (input.deadline > now) {
    await authorizePending(db, onvopay, current.id, now);
    input = await cycleInput(db, current, now);
  }

  const action = decideCycle(input);

  if (action === CycleAction.Capture) {
    await captureDeparture(db, onvopay, current);
    return;
  }

  if (action === CycleAction.Wait) {
    if (shouldForceResolve(input, RESOLUTION_MARGIN_MS)) {
      await forceResolve(db, onvopay, current, input);
    }
    return;
  }

  await releaseDeparture(db, onvopay, current, input);
}
