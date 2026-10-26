// Claims del access token de Supabase que usa el panel: el rol (custom_access_token_hook) y el
// nivel de autenticación (`aal`: aal1 con solo contraseña, aal2 con el segundo factor; spec 0049).
// Sin server-only ni Buffer: lo usa también el middleware (edge). Falla cerrado ante un token raro.
// Tampoco importa @shared: el middleware se bundlea aparte y ese import es frágil (ver middleware.ts).

export const AAL2 = 'aal2';
/** Debe coincidir con shared/constants/bookings.ts → ADMIN_PANEL_ROLES. */
const PANEL_ROLES: readonly string[] = ['admin', 'staff'];

export type SessionClaims = { userRole: string | undefined; aal: string | undefined };

export function decodeSessionClaims(accessToken: string): SessionClaims {
  try {
    const b64 = accessToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      user_role?: string;
      aal?: string;
    };
    return { userRole: payload.user_role, aal: payload.aal };
  } catch {
    return { userRole: undefined, aal: undefined };
  }
}

export function isPanelRole(role: string | undefined): boolean {
  return role !== undefined && PANEL_ROLES.includes(role);
}

/** Un usuario del panel sin el segundo factor verificado en esta sesión. */
export function needsSecondFactor(claims: SessionClaims): boolean {
  return isPanelRole(claims.userRole) && claims.aal !== AAL2;
}
