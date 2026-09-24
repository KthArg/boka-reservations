// Dobles de los servicios externos de las suites de los jobs del cobro diferido (spec 0029): el
// cliente HTTP de OnvoPay, Sentry y la llave de entorno. No es un test. El estado vive en este
// módulo: las fábricas de vi.mock y los tests lo importan y comparten la misma instancia.

export type IntentState = { status: string; amountCents?: number; currency?: string };
export type RecordedAlert = { fingerprint: string; level: string };

const DEFAULT_SECRET_KEY = 'onvo_test_integration';

export const onvo = {
  /** `null` = el GET responde 404. Sin entrada = intent ajeno a la suite: el GET lanza. */
  intents: new Map<string, IntentState | null>(),
  failingGets: new Set<string>(),
  failCancel: false,
  cancelled: [] as string[],
  methods: new Map<string, string[]>(),
  failDetach: false,
  detached: [] as string[],
  deletedCustomers: [] as string[],
  // Autorización con captura manual (spec 0033). Por defecto el confirm autoriza y la captura
  // cobra; las dos colecciones son para simular la tarjeta que falla.
  created: [] as string[],
  confirmed: [] as string[],
  captured: [] as string[],
  /** Métodos de pago cuyo confirm NO autoriza, con el estado que devuelve en su lugar. */
  declineOnConfirm: new Map<string, string>(),
  /** Intents cuya captura falla: la retención existía y el cobro no entra. */
  failingCaptures: new Set<string>(),
};

export const sentry = { alerts: [] as RecordedAlert[] };

export const envState = {
  secretKey: DEFAULT_SECRET_KEY as string | undefined,
  /** Flags del motor del mínimo (spec 0033): apagados salvo que la suite los prenda. */
  deferredChargeEnabled: false,
  releaseAuthorizationsOnly: false,
};

export function resetChargeMocks(): void {
  onvo.intents.clear();
  onvo.failingGets.clear();
  onvo.failCancel = false;
  onvo.cancelled.length = 0;
  onvo.methods.clear();
  onvo.failDetach = false;
  onvo.detached.length = 0;
  onvo.deletedCustomers.length = 0;
  onvo.created.length = 0;
  onvo.confirmed.length = 0;
  onvo.captured.length = 0;
  onvo.declineOnConfirm.clear();
  onvo.failingCaptures.clear();
  sentry.alerts.length = 0;
  envState.secretKey = DEFAULT_SECRET_KEY;
  envState.deferredChargeEnabled = false;
  envState.releaseAuthorizationsOnly = false;
}

export function alertFor(fingerprint: string): RecordedAlert | undefined {
  return sentry.alerts.find((alert) => alert.fingerprint === fingerprint);
}

export function fakeChargeClient() {
  return {
    getIntent: (id: string) => {
      if (onvo.failingGets.has(id)) return Promise.reject(new Error('onvopay getIntent 503'));
      if (!onvo.intents.has(id)) return Promise.reject(new Error(`intent ajeno a la suite ${id}`));
      return Promise.resolve(onvo.intents.get(id) ?? null);
    },
    createManualCaptureIntent: (input: { amountCents: number; currency: string }) => {
      const id = `pi_manual_${onvo.created.length + 1}_${Date.now()}`;
      onvo.created.push(id);
      onvo.intents.set(id, {
        status: 'requires_payment_method',
        amountCents: input.amountCents,
        currency: input.currency,
      });
      return Promise.resolve(id);
    },
    confirmIntent: (id: string, input: { paymentMethodId: string }) => {
      onvo.confirmed.push(id);
      const previous = onvo.intents.get(id) ?? null;
      const status = onvo.declineOnConfirm.get(input.paymentMethodId) ?? 'requires_capture';
      const snapshot = { ...(previous ?? {}), status };
      onvo.intents.set(id, snapshot);
      return Promise.resolve(snapshot);
    },
    captureIntent: (id: string) => {
      if (onvo.failingCaptures.has(id)) {
        const failed = { ...(onvo.intents.get(id) ?? {}), status: 'failed' };
        onvo.intents.set(id, failed);
        return Promise.resolve(failed);
      }
      onvo.captured.push(id);
      const succeeded = { ...(onvo.intents.get(id) ?? {}), status: 'succeeded' };
      onvo.intents.set(id, succeeded);
      return Promise.resolve(succeeded);
    },
    cancelIntent: (id: string) => {
      if (onvo.failCancel) return Promise.reject(new Error('onvopay cancelIntent 500'));
      onvo.cancelled.push(id);
      return Promise.resolve();
    },
    listAttachedPaymentMethods: (customerId: string) =>
      Promise.resolve(onvo.methods.get(customerId) ?? []),
    detachPaymentMethod: (id: string) => {
      if (onvo.failDetach) return Promise.reject(new Error('onvopay detach 500'));
      onvo.detached.push(id);
      return Promise.resolve();
    },
    deleteCustomer: (id: string) => {
      onvo.deletedCustomers.push(id);
      return Promise.resolve();
    },
  };
}

export function fakeSentryModule() {
  let level = 'warning';
  let fingerprint = '';
  return {
    captureException: () => undefined,
    captureMessage: () => {
      sentry.alerts.push({ fingerprint, level });
    },
    withScope: (callback: (scope: unknown) => void) => {
      level = 'warning';
      fingerprint = '';
      callback({
        setLevel: (value: string) => {
          level = value;
        },
        setFingerprint: ([value]: string[]) => {
          fingerprint = value ?? '';
        },
        setExtra: () => undefined,
      });
    },
  };
}

export function fakeEnvModule() {
  return {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      get ONVOPAY_SECRET_KEY() {
        return envState.secretKey;
      },
      ONVOPAY_API_BASE_URL: 'https://api.onvopay.test/v1',
      APP_URL: 'http://localhost:3000',
      get DEFERRED_CHARGE_ENABLED() {
        return envState.deferredChargeEnabled;
      },
      get RELEASE_AUTHORIZATIONS_ONLY() {
        return envState.releaseAuthorizationsOnly;
      },
    },
  };
}
