// Costura del navegador para guardar una tarjeta (spec 0029 §5.10): los componentes no conocen la
// pasarela. Hoy OnvoPay tokeniza con la publishable key y el customer del hold; otra pasarela
// (PayPal post-MVP) cambia esta re-exportación, no los componentes.
export {
  tokenizeOnvopayCard as tokenizeCard,
  CardTokenizationError,
  type TokenizationFailure,
} from './adapters/onvopay/tokenize-card';
