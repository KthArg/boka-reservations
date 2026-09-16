// Costuras del navegador para la tarjeta guardada (spec 0029 §5.10): los componentes no conocen la
// pasarela. Hoy OnvoPay tokeniza con la publishable key y el customer del hold, y completa el 3DS
// con su librería web; otra pasarela (PayPal post-MVP) cambia estas re-exportaciones, no los
// componentes.
export {
  tokenizeOnvopayCard as tokenizeCard,
  CardTokenizationError,
  type TokenizationFailure,
} from './adapters/onvopay/tokenize-card';
export {
  handleOnvopayNextAction as handleNextAction,
  type NextActionOutcome,
} from './adapters/onvopay/next-action';
