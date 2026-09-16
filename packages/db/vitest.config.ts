import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one Postgres database (TEST_DATABASE_URL);
    // running files in parallel races on shared rows (e.g. the Country seed).
    fileParallelism: false,
  },
});
