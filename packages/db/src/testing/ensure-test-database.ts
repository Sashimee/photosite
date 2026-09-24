import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { findWorktreeRoot, requireValidScope } from './worktree-scope.js';

export interface ScopedTestDatabase {
  url: string;
  databaseName: string;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function withDatabaseName(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

// Scopes a shared TEST_DATABASE_URL to one database per (worktree, workspace)
// pair, on the same Postgres server `pnpm stack:up` already starts: the
// worktree hash isolates #225's cross-worktree case, and the workspace name
// isolates concurrent `turbo run test` tasks within one worktree or CI job.
//
// The scoped database is cloned from the already-migrated-and-seeded
// `baseUrl` database via `CREATE DATABASE ... TEMPLATE`, which is an
// OS-level file copy - far cheaper than re-running migrate+seed per scope -
// and is re-cloned automatically whenever the template's migration history
// has moved on, so a stale clone from before a schema change never lingers
// silently.
export async function ensureScopedTestDatabase(
  baseUrl: string,
  scope: string,
  worktreeStartDir = process.cwd(),
): Promise<ScopedTestDatabase> {
  requireValidScope(scope);

  const parsedBase = new URL(baseUrl);
  const templateName = parsedBase.pathname.replace(/^\//, '');
  if (!templateName) {
    throw new Error(
      `ensureScopedTestDatabase: ${baseUrl} has no database name to use as a template`,
    );
  }

  const worktreeRoot = findWorktreeRoot(worktreeStartDir);
  const worktreeHash = createHash('sha1').update(worktreeRoot).digest('hex').slice(0, 8);
  const databaseName = `${templateName}__${scope}__${worktreeHash}`;

  const adminUrl = withDatabaseName(baseUrl, 'postgres');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // `CREATE DATABASE ... TEMPLATE` fails if anything else holds a
    // connection to the template at that instant, which the migration check
    // below briefly does. db/api/worker's vitest.config.ts each call this
    // concurrently under `turbo run test`, so an advisory lock on the
    // template name serialises them against each other.
    await admin.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [templateName]);
    try {
      const owner = parsedBase.username;
      const templateMigration = await latestMigration(baseUrl);
      const scopedExists = await databaseExists(admin, databaseName);

      if (scopedExists) {
        const scopedMigration = await latestMigration(withDatabaseName(baseUrl, databaseName));
        if (scopedMigration !== templateMigration) {
          await admin.query(`DROP DATABASE ${quoteIdent(databaseName)} WITH (FORCE)`);
          await createFromTemplate(admin, databaseName, templateName, owner);
        }
      } else {
        await createFromTemplate(admin, databaseName, templateName, owner);
      }
    } finally {
      await admin.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [templateName]);
    }
  } finally {
    await admin.end();
  }

  return { url: withDatabaseName(baseUrl, databaseName), databaseName };
}

async function databaseExists(admin: Client, databaseName: string): Promise<boolean> {
  const result = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  return (result.rowCount ?? 0) > 0;
}

async function createFromTemplate(
  admin: Client,
  databaseName: string,
  templateName: string,
  owner: string,
): Promise<void> {
  try {
    await admin.query(
      `CREATE DATABASE ${quoteIdent(databaseName)} TEMPLATE ${quoteIdent(templateName)} OWNER ${quoteIdent(owner)}`,
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '55006') {
      throw new Error(
        `ensureScopedTestDatabase: template database "${templateName}" is in use by another ` +
          `session and cannot be cloned. Sessions holding it:\n${await formatTemplateSessions(admin, templateName)}\n` +
          `Close those connections (e.g. a stray psql, Prisma Studio, or a dev server pointed at ` +
          `"${templateName}") and retry.`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function formatTemplateSessions(admin: Client, templateName: string): Promise<string> {
  let result;
  try {
    result = await admin.query<{
      pid: number;
      application_name: string;
      state: string | null;
    }>(
      `SELECT pid, application_name, state FROM pg_stat_activity WHERE datname = $1 AND pid != pg_backend_pid()`,
      [templateName],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `  (could not list sessions: ${message})`;
  }
  if (result.rows.length === 0) {
    return '  (none found - it may have disconnected between the failed clone and this check)';
  }
  return result.rows
    .map(
      (row) =>
        `  pid ${String(row.pid)}: ${row.application_name || '(unknown)'} [${row.state ?? 'unknown'}]`,
    )
    .join('\n');
}

// Returns the name of the most recently applied Prisma migration, or `null`
// if the database has no `_prisma_migrations` table yet (unmigrated) - used
// to detect a scoped clone that predates a schema change on the template.
async function latestMigration(databaseUrl: string): Promise<string | null> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
    );
    return result.rows[0]?.migration_name ?? null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '42P01') {
      return null;
    }
    throw error;
  } finally {
    await client.end();
  }
}
