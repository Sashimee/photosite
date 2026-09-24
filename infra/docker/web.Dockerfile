# syntax=docker/dockerfile:1
# Build context is the monorepo root: docker build -f infra/docker/web.Dockerfile .

# node:24-alpine, digest pinned so the base image never moves under us.
FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS base
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /app

# turbo prune trims the workspace to @photoo/web and the packages it
# depends on (api-client, i18n, shared, config) before anything is installed.
FROM base AS pruner
RUN npm install --global turbo@2.10.13
COPY . .
RUN turbo prune @photoo/web --docker

# pnpm fetch only needs the pruned lockfile, so this layer is cached across
# builds until a dependency actually changes, independent of source edits.
FROM base AS fetch
COPY --from=pruner /app/out/pnpm-lock.yaml /app/out/pnpm-workspace.yaml ./
RUN pnpm fetch

FROM fetch AS build
COPY --from=pruner /app/out/json/ ./
RUN pnpm install --offline --frozen-lockfile
COPY --from=pruner /app/out/full/ ./

# Left as ARGs, not ENV: ENV would coerce an unset optional one (e.g.
# NEXT_PUBLIC_SENTRY_DSN, an optional URL in apps/web/src/lib/env.ts) into
# an empty string instead of leaving it unset.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_MEDIA_BASE_URL
ARG NEXT_PUBLIC_ALLOW_INDEXING
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_REQUIRED
ENV NODE_ENV=production
RUN pnpm exec turbo run build --filter=@photoo/web...

# `output: 'standalone'` (apps/web/next.config.ts) traces the minimal
# node_modules the server needs alongside server.js.
FROM base AS runtime
# Read by apps/web/src/proxy.ts at request time, same as api.Dockerfile -
# see that file's REVISION ARG comment.
ARG REVISION
ENV NODE_ENV=production
ENV PHOTOO_REVISION=$REVISION
RUN addgroup -S app -g 1001 && adduser -S app -G app -u 1001 -h /app
# No apps/web/public/ yet; add a COPY for it here once one exists.
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/en').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
