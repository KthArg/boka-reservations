/**
 * Devuelve `value` solo si es una ruta local segura; si no, `fallback` (spec 0016, M-1).
 *
 * `redirect()` de next/navigation acepta cualquier string, incluido un host externo, así
 * que validar el destino es responsabilidad nuestra (open redirect). Se acepta solo una
 * ruta que empieza con un único `/`: se rechaza `//host` y `/\host` (que el navegador
 * interpreta como protocol-relative → host externo) y cualquier URL absoluta o esquema.
 *
 * El `value` válido ya trae el prefijo de locale (lo arma el middleware), así que se usa
 * tal cual; este helper NO antepone locale.
 */
export function safeRedirectPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  if (value.startsWith('/\\')) return fallback;
  return value;
}
