# Changelog — 0049 Captcha en el acceso al panel y segundo factor para admin y staff

Spec: [0049-captcha-y-mfa-del-panel.md](./0049-captcha-y-mfa-del-panel.md)
Rama: feat/0049-captcha-y-mfa-del-panel

## 2026-10-22 — Fase 0 y segundo factor (MFA)

**Hecho**:

- **Fase 0 en el Supabase local**, con scripts contra GoTrue:
  - el JWT trae `aal1` tras la contraseña y `aal2` tras `verify`, y el hook conserva `user_role`;
  - con `aal1` y un factor verificado, GoTrue rechaza enrolar otro, dar de baja el existente y cambiar la contraseña (`insufficient_aal`);
  - el cambio de contraseña por la API de admin revoca los refresh tokens; el ban y desban, no.

  Con eso se descartó la función `revoke_user_sessions` del spec.

- **Migración …064**:
  - política RESTRICTIVE de `aal2` en las 12 tablas del panel y en `storage.objects`;
  - `panel_tables_missing_aal2()`, una auditoría no enumerativa (solo service_role).
- **Web**:
  - `session-claims.ts` (rol y `aal` del JWT, sin `@shared`, apto para el middleware edge);
  - `requireAuth` chequea `aal` antes de leer `users` (`MFA_REQUIRED`);
  - el middleware y el layout del panel redirigen a `/mfa`;
  - el login siempre va a `/mfa`;
  - la página `/mfa` maneja enrolamiento con QR y clave, desafío y cerrar sesión;
  - `verifyMfaAction` corre en el servidor, con límite de 10 intentos cada 15 minutos por usuario, y audita `user.mfa_enrolled`.
- **Reseteo del factor** (Usuarios): borra los factores, cambia la contraseña por una aleatoria (eso cierra las sesiones), manda el correo de acceso y audita `user.mfa_reset`. No se puede sobre uno mismo.
- **Recuperación por `/auth/callback`**: fija la contraseña con el cliente de servicio, porque `updateUser` con `aal1` y un factor da `insufficient_aal`.
- **Supabase**:
  - TOTP habilitado en `config.toml`;
  - notificación de seguridad "MFA factor enrolled", con plantilla propia (`supabase/templates/mfa_factor_enrolled.html`).
- **Tests**:
  - helper `completeSecondFactor` con TOTP propio (RFC 6238, verificado contra los vectores del apéndice B);
  - 9 suites que usaban sesiones de panel pasan a `aal2`;
  - `mfa-rls.test.ts`: 12 tablas, escritura, Storage, la auditoría y los supuestos de GoTrue;
  - `mfa-actions.test.ts`: enrolamiento, verificación, límite, reseteo e idempotencia;
  - unit de middleware, `requireAuth` y login;
  - runbook `docs/operacion/segundo-factor.md`.

**Por qué / decisiones**:

- El enrolamiento crea el factor desde un efecto del cliente, no en el render del servidor: un prefetch del GET no debe crear factores.
- `mfa-actions.test.ts` usa un staff propio del archivo. La API de admin aplica la política de contraseñas y no deja restaurar `staff1234` del seed (sin mayúscula): si el reseteo tocaba al staff del seed, rompía las suites siguientes.
- Las suites de integración que fallaron con la RLS nueva lo hicieron porque sus sesiones de panel eran `aal1`. Es el comportamiento buscado (spec 0049 §8), y se actualizaron para que las sesiones pasen a `aal2`.

**Revisiones**:

- **code-reviewer, bloqueante corregido**: la primera versión de la rama de autoservicio de `/reset-password` fijaba la contraseña del usuario de _cualquier_ sesión. Con eso, una contraseña robada alcanzaba para cambiarla sin segundo factor. Ahora `/auth/callback` emite la misma cookie firmada que `/auth/confirm` y cierra la sesión de recuperación, y `/reset-password` solo acepta esa cookie.
- **Otras mejoras aplicadas**:
  - los redirects del middleware conservan las cookies renovadas;
  - `unenroll` y `listFactors` chequean el error;
  - `/mfa` no acepta volver a `/mfa` como destino (`mfaDestination`);
  - el código `MFA_REQUIRED` es una constante;
  - si el correo de acceso del reseteo no sale, el admin lo ve (`MfaResetEmailFailed`) y la auditoría registra `access_email_sent`;
  - el botón de reseteo tiene tono de acción destructiva.
- **db-schema-guardian**: sin bloqueantes. La auditoría ahora exige el nombre exacto, `FOR ALL`, `TO authenticated` y el mismo `USING` y `WITH CHECK`, y pasó a SECURITY INVOKER.
- **Dos PRs**: `supabase db push` aplica todas las migraciones pendientes juntas. Si …064 llegara a `main` antes de que el equipo enrole, el próximo push de cualquier otra migración la aplicaría y dejaría sin datos a las sesiones `aal1`. Por eso la …064, `panel_tables_missing_aal2` y `mfa-rls.test.ts` van en un PR aparte (`feat/0049-rls-aal2`), que se mergea después de confirmar `has_mfa`.
- El hueco 062 → 064 es intencional: la …063 es del spec 0048 (PR #117).

**Pendiente**:

- **Producción, en este orden**:
  1. desplegar la web;
  2. habilitar la notificación "MFA factor enrolled" en el dashboard con la plantilla;
  3. el equipo enrola el mismo día;
  4. confirmar `has_mfa` en Usuarios;
  5. recién entonces mergear el PR de la …064 y hacer `supabase db push`.
- Confirmar en el Supabase alojado la semántica de "Limit duration of AAL1 sessions".
- **Captcha** (segunda parte del spec): espera el aviso de privacidad actualizado.
