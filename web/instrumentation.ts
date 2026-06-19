// Sentry deshabilitado temporalmente para aislar un MIDDLEWARE_INVOCATION_FAILED en el runtime
// Edge de Vercel (la instrumentación de Sentry corre al iniciar el isolate del edge). Sentry está
// inactivo igual en esta fase (sin DSN). Re-habilitar con la config correcta una vez confirmado.
export async function register() {}
