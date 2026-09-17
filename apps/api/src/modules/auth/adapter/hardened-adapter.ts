import type { DBAdapter, DBAdapterInstance, DBTransactionAdapter, Where } from 'better-auth';
import { decryptAesGcm, encryptAesGcm } from '@photoo/shared/crypto';
import { sha256Hex } from '../../../common/crypto/hash.js';

type Row = Record<string, unknown>;

function isPlainObject(value: unknown): value is Row {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function hashTokenInData(data: Row): { data: Row; rawToken: string | undefined } {
  if (typeof data.token !== 'string') {
    return { data, rawToken: undefined };
  }
  const rawToken = data.token;
  return { data: { ...data, token: sha256Hex(rawToken) }, rawToken };
}

function hashTokenInWhere(where: readonly Where[] | undefined): {
  where: Where[] | undefined;
  rawToken: string | undefined;
} {
  if (!where) {
    return { where: undefined, rawToken: undefined };
  }
  let rawToken: string | undefined;
  const mapped = where.map((clause) => {
    if (clause.field !== 'token') {
      return clause;
    }
    if (Array.isArray(clause.value)) {
      const values = clause.value as unknown[];
      const hashed = values.map((value) => {
        if (typeof value !== 'string') {
          return value;
        }
        rawToken = value;
        return sha256Hex(value);
      });
      return { ...clause, value: hashed } as Where;
    }
    if (typeof clause.value === 'string') {
      rawToken = clause.value;
      return { ...clause, value: sha256Hex(clause.value) };
    }
    return clause;
  });
  return { where: mapped, rawToken };
}

// `emailVerified` <-> `emailVerifiedAt` bridging lives in the Prisma client
// extension (user-email-verified-extension.ts), not here: better-auth's
// adapter factory re-injects the declared default for that field after this
// wrapper runs, so stripping it at this layer does not survive to Prisma.
function bridgeUserWriteData(data: Row): Row {
  if (!('image' in data)) {
    return data;
  }
  const next = { ...data };
  delete next.image;
  return next;
}

function bridgeUserRow(row: Row): Row {
  if ('email' in row && !('image' in row)) {
    return { ...row, image: null };
  }
  return row;
}

function bridgeUserReadRow<T>(row: T): T {
  if (!isPlainObject(row)) {
    return row;
  }
  let next = bridgeUserRow(row);
  for (const [key, value] of Object.entries(next)) {
    if (isPlainObject(value) && 'email' in value) {
      next = { ...next, [key]: bridgeUserRow(value) };
    }
  }
  return next as T;
}

function encryptTwoFactorSecretInData(data: Row, key: Buffer): Row {
  if (typeof data.secret !== 'string') {
    return data;
  }
  return { ...data, secret: encryptAesGcm(data.secret, key) };
}

function decryptTwoFactorSecretInRow<T>(row: T, key: Buffer): T {
  if (!isPlainObject(row) || typeof row.secret !== 'string') {
    return row;
  }
  return { ...row, secret: decryptAesGcm(row.secret, key) };
}

function restoreSessionToken<T>(row: T, rawToken: string | undefined): T {
  if (!rawToken || !isPlainObject(row) || !('token' in row)) {
    return row;
  }
  return { ...row, token: rawToken };
}

function transformWriteData(model: string, data: Row, authEncryptionKey: Buffer): Row {
  let next = data;
  if (model === 'user') {
    next = bridgeUserWriteData(next);
  }
  if (model === 'twoFactor') {
    next = encryptTwoFactorSecretInData(next, authEncryptionKey);
  }
  return next;
}

function transformReadRow<T>(model: string, row: T, authEncryptionKey: Buffer): T {
  let next = row;
  if (model === 'user' || model === 'session') {
    next = bridgeUserReadRow(next);
  }
  if (model === 'twoFactor') {
    next = decryptTwoFactorSecretInRow(next, authEncryptionKey);
  }
  return next;
}

type AdapterLike = Omit<DBAdapter, 'transaction'> & { transaction?: DBAdapter['transaction'] };

function wrapAdapter<A extends AdapterLike>(adapter: A, authEncryptionKey: Buffer): A {
  const wrapped: AdapterLike = {
    ...adapter,
    create: async ({ model, data, select, forceAllowId }) => {
      let nextData = transformWriteData(model, data, authEncryptionKey) as typeof data;
      let rawToken: string | undefined;
      if (model === 'session') {
        const hashed = hashTokenInData(nextData);
        nextData = hashed.data as typeof data;
        rawToken = hashed.rawToken;
      }
      const result = await adapter.create({ model, data: nextData, select, forceAllowId });
      const bridged = transformReadRow(model, result, authEncryptionKey);
      return restoreSessionToken(bridged, rawToken);
    },
    findOne: async ({ model, where, select, join }) => {
      const { where: nextWhere, rawToken } = hashTokenInWhere(where);
      const result = await adapter.findOne({
        model,
        where: nextWhere ?? where,
        select,
        join,
      });
      if (result === null) {
        return result;
      }
      const bridged = transformReadRow(model, result, authEncryptionKey);
      return restoreSessionToken(bridged, rawToken);
    },
    findMany: async ({ model, where, limit, select, sortBy, offset, join }) => {
      const { where: nextWhere, rawToken } = hashTokenInWhere(where);
      const results = await adapter.findMany({
        model,
        where: nextWhere ?? where,
        limit,
        select,
        sortBy,
        offset,
        join,
      });
      return results.map((row) =>
        restoreSessionToken(transformReadRow(model, row, authEncryptionKey), rawToken),
      );
    },
    update: async ({ model, where, update }) => {
      const { where: nextWhere, rawToken: whereRawToken } = hashTokenInWhere(where);
      let nextUpdate = transformWriteData(model, update as Row, authEncryptionKey) as typeof update;
      let updateRawToken: string | undefined;
      if (model === 'session') {
        const hashed = hashTokenInData(nextUpdate as Row);
        nextUpdate = hashed.data as typeof update;
        updateRawToken = hashed.rawToken;
      }
      const result = await adapter.update({
        model,
        where: nextWhere ?? where,
        update: nextUpdate,
      });
      if (result === null) {
        return result;
      }
      const bridged = transformReadRow(model, result, authEncryptionKey);
      return restoreSessionToken(bridged, updateRawToken ?? whereRawToken);
    },
    updateMany: async ({ model, where, update }) => {
      const { where: nextWhere } = hashTokenInWhere(where);
      const nextUpdate = transformWriteData(model, update as Row, authEncryptionKey);
      const { data: hashedUpdate } =
        model === 'session' ? hashTokenInData(nextUpdate) : { data: nextUpdate };
      return adapter.updateMany({
        model,
        where: nextWhere ?? where,
        update: hashedUpdate,
      });
    },
    delete: async ({ model, where }) => {
      const { where: nextWhere } = hashTokenInWhere(where);
      return adapter.delete({ model, where: nextWhere ?? where });
    },
    deleteMany: async ({ model, where }) => {
      const { where: nextWhere } = hashTokenInWhere(where);
      return adapter.deleteMany({ model, where: nextWhere ?? where });
    },
    consumeOne: async ({ model, where }) => {
      const { where: nextWhere, rawToken } = hashTokenInWhere(where);
      const result = await adapter.consumeOne({
        model,
        where: nextWhere ?? where,
      });
      if (result === null) {
        return result;
      }
      const bridged = transformReadRow(model, result, authEncryptionKey);
      return restoreSessionToken(bridged, rawToken);
    },
    incrementOne: async ({ model, where, increment, set }) => {
      const { where: nextWhere, rawToken } = hashTokenInWhere(where);
      const result = await adapter.incrementOne({
        model,
        where: nextWhere ?? where,
        increment,
        set,
      });
      if (result === null) {
        return result;
      }
      const bridged = transformReadRow(model, result, authEncryptionKey);
      return restoreSessionToken(bridged, rawToken);
    },
    count: async ({ model, where }) => {
      const { where: nextWhere } = hashTokenInWhere(where);
      return adapter.count({ model, where: nextWhere ?? where });
    },
  };

  const transaction = adapter.transaction;
  if (transaction) {
    wrapped.transaction = async (callback) =>
      transaction((trx: DBTransactionAdapter) =>
        callback(wrapAdapter(trx as AdapterLike, authEncryptionKey) as DBTransactionAdapter),
      );
  }

  return wrapped as A;
}

export function hardenAdapter(
  base: DBAdapterInstance,
  authEncryptionKey: Buffer,
): DBAdapterInstance {
  return (options) => wrapAdapter(base(options) as AdapterLike, authEncryptionKey) as DBAdapter;
}
