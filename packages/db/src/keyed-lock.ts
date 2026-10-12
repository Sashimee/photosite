import { Pool, type PoolClient } from 'pg';

export type KeyedLockResult<T> = { acquired: true; value: T } | { acquired: false };

export interface KeyedLock {
  tryRun<T>(key: string, fn: () => Promise<T>): Promise<KeyedLockResult<T>>;
  end(): Promise<void>;
}

export interface KeyedLockOptions {
  maxConnections?: number;
  connectionTimeoutMillis?: number;
  onIdleClientError?: (error: Error) => void;
}

// Session-level advisory locks outlive a transaction, so work that must not
// sit inside one (a Stripe call) can still be serialised per key. Prisma's
// driver adapter cannot pin a connection outside `$transaction`, hence the
// dedicated pool: the lock and its unlock must run on the same connection.
export function createKeyedLock(databaseUrl: string, options: KeyedLockOptions = {}): KeyedLock {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    idleTimeoutMillis: 10_000,
  });
  pool.on('error', (error) => {
    options.onIdleClientError?.(error);
  });

  return {
    async tryRun<T>(key: string, fn: () => Promise<T>): Promise<KeyedLockResult<T>> {
      const client = await pool.connect();
      let acquired = false;
      try {
        const { rows } = await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked',
          [key],
        );
        acquired = rows[0]?.locked === true;
        if (!acquired) {
          return { acquired: false };
        }
        return { acquired: true, value: await fn() };
      } finally {
        await unlockAndRelease(client, key, acquired);
      }
    },
    end: () => pool.end(),
  };
}

// A connection whose unlock failed may still hold the lock; destroying it
// ends the session, which is what frees a session-level advisory lock.
async function unlockAndRelease(client: PoolClient, key: string, acquired: boolean): Promise<void> {
  if (!acquired) {
    client.release();
    return;
  }
  try {
    const { rows } = await client.query<{ unlocked: boolean }>(
      'SELECT pg_advisory_unlock(hashtext($1)::bigint) AS unlocked',
      [key],
    );
    if (rows[0]?.unlocked !== true) {
      client.release(new Error(`keyed lock: advisory lock for ${key} was not held at unlock`));
      return;
    }
    client.release();
  } catch (error) {
    client.release(error instanceof Error ? error : new Error(String(error)));
  }
}
