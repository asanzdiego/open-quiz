import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.vitest/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'src/**/*.ts',
      'tests/**/*.ts',
      'scripts/**/*.ts',
      'scripts/**/*.mjs',
      '*.ts',
      '*.mjs',
    ],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, io: 'readonly' },
    },
  },
];
