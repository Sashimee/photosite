import { createConfig } from '@photoo/config/eslint';

export default [{ ignores: ['src/schema.ts'] }, ...createConfig(import.meta.dirname)];
