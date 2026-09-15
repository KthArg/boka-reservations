// Forma de un id de método de pago que llega del navegador (spec 0029 §5.2): sin `/`, `.` ni `?`,
// que alterarían la ruta del GET firmado con la secret key. El adapter además lo escapa.
export const PAYMENT_METHOD_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
