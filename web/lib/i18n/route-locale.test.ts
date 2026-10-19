import { describe, expect, it } from 'vitest';
import { resolveRouteLocale } from './route-locale';

describe('resolveRouteLocale', () => {
  it.each(['es', 'en'])('deja pasar el locale válido %s', (locale) => {
    expect(resolveRouteLocale(locale)).toBe(locale);
  });

  it.each(['/evil.com', '//evil.com', 'evil.com', '', 'ES'])(
    'cae al default con %j y la redirección queda en el mismo origen',
    (raw) => {
      const locale = resolveRouteLocale(raw);
      expect(locale).toBe('es');
      expect(new URL(`/${locale}/forgot-password`, 'https://reservas.example').origin).toBe(
        'https://reservas.example',
      );
    },
  );
});
