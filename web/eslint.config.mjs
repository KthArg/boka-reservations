import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'node_modules/**']),
  {
    rules: {
      // Límite de 150 líneas no-vacías y no-comentario por archivo
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],

      // Prohibir números mágicos con excepciones explícitas
      'no-magic-numbers': [
        'warn',
        {
          ignore: [0, 1, -1, 2, 100, 200, 400, 404, 500],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
        },
      ],

      // Detectar strings literales en comparaciones de estado/tipo
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "BinaryExpression[operator='==='] > Literal[value=/^(admin|staff|guide|pending|confirmed|cancelled|failed|active|inactive|USD|CRC)$/]",
          message: 'Usar constantes de shared/constants/ en lugar de string literal.',
        },
      ],
    },
  },
  {
    // Tests: excluir no-magic-numbers porque los literales en asserts son intencionales
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**'],
    rules: {
      'no-magic-numbers': 'off',
      'max-lines': 'off',
    },
  },
  {
    // Locales i18n: son datos puros, excluir límite de líneas
    files: ['locales/**'],
    rules: {
      'max-lines': 'off',
    },
  },
]);

export default eslintConfig;
