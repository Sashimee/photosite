import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy packages/db/.env.example to packages/db/.env and set it.',
    );
  }
  return url;
}

function getShadowDatabaseUrl(): string {
  const url = process.env.SHADOW_DATABASE_URL;
  if (!url) {
    throw new Error(
      'SHADOW_DATABASE_URL is not set. Copy packages/db/.env.example to packages/db/.env and set it. Prisma wipes this database when generating migrations, so it must never be the dev or test database.',
    );
  }
  return url;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    get url() {
      return getDatabaseUrl();
    },
    get shadowDatabaseUrl() {
      return getShadowDatabaseUrl();
    },
  },
});
