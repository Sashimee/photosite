import { createConfig } from '@photoo/config/eslint';

export default [
  ...createConfig(import.meta.dirname),
  {
    languageOptions: {
      parserOptions: {
        // Every other *.config.{js,ts} file is already covered by tsconfig.json.
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
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
