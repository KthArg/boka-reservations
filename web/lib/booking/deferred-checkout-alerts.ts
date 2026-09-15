import 'server-only';
import { captureAlert } from './sentry-alert';

// Alertas del checkout diferido y del cambio de tarjeta (spec 0029 §5.2). Solo ids de hold, reserva
// y customer. Un customer que no se pudo borrar, o cuyo id nunca llegó, deja datos del turista en
// OnvoPay sin reserva que los justifique (spec 0022): tiene que quedar rastro para borrarlo a mano.

/** createCustomer falló: un timeout pudo haber creado el customer sin devolver su id. */
export function alertCustomerCreateFailed(holdId: string): void {
  captureAlert(
    '[deferred-checkout] createCustomer falló: puede haber un customer sin registrar en OnvoPay',
    'deferred-checkout-customer-create-failed',
    { holdId },
  );
}

export function alertOrphanedCustomer(customerId: string, holdId: string): void {
  captureAlert(
    '[deferred-checkout] no se pudo borrar el customer de un checkout fallido',
    'deferred-checkout-customer-orphaned',
    { customerId, holdId },
  );
}

/** Tarjeta de otro customer en el paso 2: señal de manipulación del checkout. */
export function alertCardCustomerMismatch(holdId: string): void {
  captureAlert(
    '[deferred-checkout] tarjeta de otro customer en el paso 2',
    'deferred-checkout-card-customer-mismatch',
    { holdId },
  );
}

/** Tarjeta de otro customer al actualizar la de una reserva: señal de manipulación. */
export function alertCardUpdateCustomerMismatch(bookingId: string): void {
  captureAlert(
    '[card-update] tarjeta de otro customer al actualizar la de una reserva',
    'card-update-customer-mismatch',
    { bookingId },
  );
}

/** No se pudo desvincular una tarjeta (reemplazada o rechazada): sigue vinculada al customer. */
export function alertCardNotDetached(bookingId: string): void {
  captureAlert(
    '[card-update] no se pudo desvincular una tarjeta; la limpieza del customer la retoma',
    'card-update-detach-failed',
    { bookingId },
  );
}
