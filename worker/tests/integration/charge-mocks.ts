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
};

export const sentry = { alerts: [] as RecordedAlert[] };

export const envState = { secretKey: DEFAULT_SECRET_KEY as string | undefined };

export function resetChargeMocks(): void {
  onvo.intents.clear();
  onvo.failingGets.clear();
  onvo.failCancel = false;
  onvo.cancelled.length = 0;
  onvo.methods.clear();
  onvo.failDetach = false;
  onvo.detached.length = 0;
  onvo.deletedCustomers.length = 0;
  sentry.alerts.length = 0;
  envState.secretKey = DEFAULT_SECRET_KEY;
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
    },
  };
}
