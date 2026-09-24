import { createConfig } from '@photoo/config/eslint';
import tseslint from 'typescript-eslint';

export default [
  ...createConfig(import.meta.dirname),
  {
    languageOptions: {
      parserOptions: {
        // playwright.config.ts is already covered by tsconfig.json, so it can't also match here.
        // tests/lighthouse/*.cjs are plain CommonJS (required directly by @lhci/cli and by each
        // other via `require`, no build step), so they're never part of any tsconfig project either.
        projectService: { allowDefaultProject: ['*.js', '*.mjs', 'tests/lighthouse/*.cjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Same treatment packages/config/eslint/base.js already gives `**/*.js`:
  // plain CommonJS has no types to check, so the strict type-checked rules
  // (which read every `require()` result as `any`) just add noise here.
  {
    files: ['tests/lighthouse/**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // These files are `.cjs` specifically so @lhci/cli and Node can
      // `require()` them directly under this package's `"type": "module"` -
      // an `import` here would defeat the point.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
