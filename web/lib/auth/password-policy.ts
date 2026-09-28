import { z } from 'zod';

/**
 * Política de contraseñas del panel. Debe coincidir con Supabase Auth
 * (`minimum_password_length` y `password_requirements = "lower_upper_letters_digits"` en
 * supabase/config.toml y en el proyecto de producción): si la app acepta una contraseña que Auth
 * rechaza, el usuario ve un error en vez de su contraseña fijada.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Mismo criterio como `pattern` HTML, para que el navegador avise antes de enviar. */
export const PASSWORD_PATTERN = '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}';

export const PasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/);
