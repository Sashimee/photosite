import { createConfig } from '@photoo/config/eslint';

export default [
  ...createConfig(import.meta.dirname),
  {
    languageOptions: {
      parserOptions: {
        // *.config.ts is covered by tsconfig.json; JS config files use the default
        // project, matching the other workspaces so a multi-package eslint run agrees.
        projectService: { allowDefaultProject: ['*.js', '*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['*.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
