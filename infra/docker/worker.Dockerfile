# syntax=docker/dockerfile:1
# Build context is the monorepo root: docker build -f infra/docker/worker.Dockerfile .

# node:24-alpine, digest pinned so the base image never moves under us.
FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS base
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /app

# turbo prune trims the workspace to @photoo/worker and the packages it
# depends on (db, email, i18n, shared, config) before anything is installed.
FROM base AS pruner
RUN npm install --global turbo@2.10.13
COPY . .
RUN turbo prune @photoo/worker --docker

# pnpm fetch only needs the pruned lockfile, so this layer is cached across
# builds until a dependency actually changes, independent of source edits.
FROM base AS fetch
COPY --from=pruner /app/out/pnpm-lock.yaml /app/out/pnpm-workspace.yaml ./
RUN pnpm fetch

FROM fetch AS build
COPY --from=pruner /app/out/json/ ./
RUN pnpm install --offline --frozen-lockfile
COPY --from=pruner /app/out/full/ ./
RUN pnpm exec turbo run build --filter=@photoo/worker...

FROM build AS prod-deps
RUN pnpm prune --prod --ignore-scripts

# @prisma/client's peer dep on the `prisma` CLI drags in its studio/dev-
# server tree (>600 MB) even after `pnpm prune --prod`; unused at runtime.
FROM prod-deps AS trimmed
RUN rm -rf \
      node_modules/.pnpm/prisma@* \
      node_modules/.pnpm/@prisma+studio-core@* \
      node_modules/.pnpm/@prisma+dev@* \
      node_modules/.pnpm/@electric-sql+pglite@* \
      node_modules/.pnpm/effect@* \
      node_modules/.pnpm/elkjs@* \
      node_modules/.pnpm/next@* \
      node_modules/.pnpm/@next+swc-linux-x64-musl@* \
      node_modules/.pnpm/lightningcss-linux-x64-musl@* \
      node_modules/.pnpm/@rolldown+binding-linux-x64-musl@* \
  && find . -name '*.map' -delete

# Runtime image: no devDependencies, no source maps, non-root user.
FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S app -g 1001 && adduser -S app -G app -u 1001 -h /app
COPY --from=trimmed --chown=app:app /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=trimmed --chown=app:app /app/node_modules ./node_modules
COPY --from=trimmed --chown=app:app /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=trimmed --chown=app:app /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=trimmed --chown=app:app /app/apps/worker/dist ./apps/worker/dist
COPY --from=trimmed --chown=app:app /app/packages/db/package.json ./packages/db/package.json
COPY --from=trimmed --chown=app:app /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=trimmed --chown=app:app /app/packages/db/dist ./packages/db/dist
COPY --from=trimmed --chown=app:app /app/packages/email/package.json ./packages/email/package.json
COPY --from=trimmed --chown=app:app /app/packages/email/node_modules ./packages/email/node_modules
COPY --from=trimmed --chown=app:app /app/packages/email/dist ./packages/email/dist
COPY --from=trimmed --chown=app:app /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=trimmed --chown=app:app /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=trimmed --chown=app:app /app/packages/shared/dist ./packages/shared/dist
COPY --from=trimmed --chown=app:app /app/packages/i18n/package.json ./packages/i18n/package.json
COPY --from=trimmed --chown=app:app /app/packages/i18n/node_modules ./packages/i18n/node_modules
COPY --from=trimmed --chown=app:app /app/packages/i18n/dist ./packages/i18n/dist
COPY --from=trimmed --chown=app:app /app/packages/i18n/messages ./packages/i18n/messages
USER app
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||4100)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/worker/dist/main.js"]
