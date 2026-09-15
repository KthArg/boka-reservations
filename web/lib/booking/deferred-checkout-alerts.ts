import 'server-only';
import * as Sentry from '@sentry/nextjs';

// Alertas del checkout diferido (spec 0029 §5.2). Sin PII: solo ids de hold y de customer. Un
// customer que no se pudo borrar, o cuyo id nunca llegó, deja datos del turista en OnvoPay sin
// reserva que los justifique (spec 0022): tiene que quedar rastro para borrarlo a mano.

function capture(message: string, fingerprint: string, extras: Record<string, string>): void {
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setFingerprint([fingerprint]);
    for (const [key, value] of Object.entries(extras)) scope.setExtra(key, value);
    Sentry.captureMessage(message);
  });
}

/** createCustomer falló: un timeout pudo haber creado el customer sin devolver su id. */
export function alertCustomerCreateFailed(holdId: string): void {
  capture(
    '[deferred-checkout] createCustomer falló: puede haber un customer sin registrar en OnvoPay',
    'deferred-checkout-customer-create-failed',
    { holdId },
  );
}

export function alertOrphanedCustomer(customerId: string, holdId: string): void {
  capture(
    '[deferred-checkout] no se pudo borrar el customer de un checkout fallido',
    'deferred-checkout-customer-orphaned',
    { customerId, holdId },
  );
}

/** Tarjeta de otro customer en el paso 2: señal de manipulación del checkout. */
export function alertCardCustomerMismatch(holdId: string): void {
  capture(
    '[deferred-checkout] tarjeta de otro customer en el paso 2',
    'deferred-checkout-card-customer-mismatch',
    { holdId },
  );
}
