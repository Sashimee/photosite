import { createConfig } from '@photoo/config/eslint';

export default [
  { ignores: ['src/generated/**'] },
  ...createConfig(import.meta.dirname),
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js', '*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
