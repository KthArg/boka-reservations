/**
 * Devuelve `value` solo si es una ruta local segura; si no, `fallback` (spec 0016, M-1;
 * endurecido en spec 0019, F-1).
 *
 * `redirect()` de next/navigation acepta cualquier string, incluido un host externo, así
 * que validar el destino es responsabilidad nuestra (open redirect). Se acepta solo una
 * ruta que empieza con un único `/`: se rechaza `//host` y `/\host` (que el navegador
 * interpreta como protocol-relative → host externo) y cualquier URL absoluta o esquema.
 *
 * IMPORTANTE (F-1): además se rechazan los caracteres de control (tab/LF/CR y demás
 * 0x00–0x1f/0x7f) y el backslash en CUALQUIER posición. El navegador y el parser de URL
 * (WHATWG) ELIMINAN tab/LF/CR antes de resolver, así que un valor como `"/\t/evil.com"`
 * pasaría el chequeo de `//` y luego colapsaría a `//evil.com` → host externo. Sin este
 * filtro el guard de protocol-relative es evadible (verificado por PoC en la auditoría).
 *
 * El `value` válido ya trae el prefijo de locale (lo arma el middleware), así que se usa
 * tal cual; este helper NO antepone locale.
 */
const CONTROL_CHAR_MAX = 0x1f;
const DEL_CHAR = 0x7f;
const BACKSLASH = 0x5c;

/**
 * true si el value contiene un carácter de control (0x00–0x1f/0x7f) o un backslash. El
 * parser de URL los elimina/normaliza, así que habilitarían el bypass del guard de '//'.
 */
function hasUnsafeRedirectChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= CONTROL_CHAR_MAX || code === DEL_CHAR || code === BACKSLASH) return true;
  }
  return false;
}

export function safeRedirectPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  if (hasUnsafeRedirectChar(value)) return fallback;
  return value;
}
