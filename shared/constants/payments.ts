/** Constantes del flujo de pago con OnvoPay (spec 0028, C4). */

/** Base del API REST de OnvoPay. Es también el host de sandbox: el modo lo define la llave (spec 0029 §5.1). */
export const ONVOPAY_API_BASE_URL_DEFAULT = 'https://api.onvopay.com/v1';

/** URL del SDK embebible (widget de pago). */
export const ONVO_SDK_URL = 'https://sdk.onvopay.com/sdk.js';

/** Tipo de pago del widget: cobro único (no suscripción). */
export const ONVO_PAYMENT_TYPE_ONE_TIME = 'one_time';
