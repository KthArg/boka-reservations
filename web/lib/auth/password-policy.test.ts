import { describe, expect, it } from 'vitest';
import { PASSWORD_PATTERN, PasswordSchema } from './password-policy';

// El `pattern` HTML se evalúa anclado a la cadena completa (flag `v`).
const htmlPattern = new RegExp(`^(?:${PASSWORD_PATTERN})$`, 'v');

describe('política de contraseñas', () => {
  it.each(['Boka2026verde', 'aB3aaaaa'])('acepta %s', (password) => {
    expect(PasswordSchema.safeParse(password).success).toBe(true);
    expect(htmlPattern.test(password)).toBe(true);
  });

  it.each([
    ['más corta de 8', 'aB3aaaa'],
    ['sin mayúscula', 'boka2026verde'],
    ['sin minúscula', 'BOKA2026VERDE'],
    ['sin número', 'BokaVerdeCR'],
  ])('rechaza una contraseña %s', (_case, password) => {
    expect(PasswordSchema.safeParse(password).success).toBe(false);
    expect(htmlPattern.test(password)).toBe(false);
  });
});
