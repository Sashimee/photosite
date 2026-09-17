import { createConfig } from '@photoo/config/eslint';

export default [
  ...createConfig(import.meta.dirname),
  {
    languageOptions: {
      parserOptions: {
        // *.config.ts is already covered by tsconfig.json, so it can't also match here.
        projectService: { allowDefaultProject: ['*.js', '*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
