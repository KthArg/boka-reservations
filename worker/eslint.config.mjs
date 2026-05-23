import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '*.mjs'],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'no-magic-numbers': [
        'warn',
        {
          ignore: [0, 1, -1, 2, 100, 200, 400, 404, 500],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
        },
      ],
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
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      'no-magic-numbers': 'off',
      'max-lines': 'off',
    },
  },
);
