import { createConfig } from '@photoo/config/eslint';
import nextPlugin from '@next/eslint-plugin-next';

export default [
  ...createConfig(import.meta.dirname),
  nextPlugin.configs['core-web-vitals'],
  {
    languageOptions: {
      parserOptions: {
        // *.config.ts is already covered by tsconfig.json, so it can't also match here.
        projectService: { allowDefaultProject: ['*.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { ignores: ['.next/**'] },
];
