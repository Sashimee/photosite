import type { PrismaClient } from '@photoo/db';

// Better Auth's core "user" schema declares `emailVerified` (boolean) as a
// required field with a default, so its adapter factory re-injects it into
// every create/update payload even after a wrapping DBAdapter strips it —
// stripping it at the DBAdapter layer (see hardened-adapter.ts) is too early
// to survive that re-injection. A Prisma Client Extension sits at the actual
// query boundary, so it is the layer that reliably sees (and can rewrite)
// the final payload, and reliably attaches a synthetic `emailVerified` to
// every read from the real `emailVerifiedAt` column.
function toEmailVerifiedAtData(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || !('emailVerified' in data)) {
    return data;
  }
  const { emailVerified, ...rest } = data;
  return { ...rest, emailVerifiedAt: emailVerified ? new Date() : null };
}

// The extended client's type intentionally narrows away methods like `$on`
// that this module never uses; callers only ever pass the result into
// `prismaAdapter()`, whose `PrismaClient` parameter type is an empty
// interface that accepts any object shape.
export function withEmailVerifiedBridge(client: PrismaClient): PrismaClient {
  const extended = client.$extends({
    name: 'user-email-verified-bridge',
    result: {
      user: {
        emailVerified: {
          needs: { emailVerifiedAt: true },
          compute(user: { emailVerifiedAt: Date | null }): boolean {
            return user.emailVerifiedAt != null;
          },
        },
      },
    },
    query: {
      user: {
        create({ args, query }) {
          args.data = toEmailVerifiedAtData(args.data) as typeof args.data;
          return query(args);
        },
        update({ args, query }) {
          args.data = toEmailVerifiedAtData(args.data) as typeof args.data;
          return query(args);
        },
        upsert({ args, query }) {
          args.create = toEmailVerifiedAtData(args.create) as typeof args.create;
          args.update = toEmailVerifiedAtData(args.update) as typeof args.update;
          return query(args);
        },
      },
    },
  });
  return extended as unknown as PrismaClient;
}
