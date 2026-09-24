# syntax=docker/dockerfile:1
# Build context is the monorepo root: docker build -f infra/docker/minio-mirror.Dockerfile --target minio .
#
# MinIO Inc. archived github.com/minio/minio and github.com/minio/mc (Community
# Edition) and pulled anonymous access to their quay.io images and dl.min.io
# binaries (#326) - `docker pull quay.io/minio/{minio,mc}` now 401s, and
# https://dl.min.io/.../minio now 410s, both permanently. The Go module source
# is still public (archived repos are read-only, not deleted) and the module
# proxy at proxy.golang.org caches dependencies indefinitely, so this builds
# both binaries from the exact tagged source instead of pulling a prebuilt
# image, then infra/dokploy/mirror-minio.yml (sic: .github/workflows) pushes
# the result to ghcr.io/sashimee/{minio,mc} once - see that workflow's own
# comment for the refresh policy.
#
# golang:1.24-alpine, digest pinned so the builder never moves under us.
FROM golang:1.24-alpine@sha256:8bee1901f1e530bfb4a7850aa7a479d17ae3a18beb6e09064ed54cfd245b7191 AS build
RUN apk add --no-cache git ca-certificates
ENV CGO_ENABLED=0

ARG MINIO_VERSION=RELEASE.2025-09-07T16-13-09Z
ARG MINIO_COMMIT=07c3a429bfed433e49018cb0f78a52145d4bedeb
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z
ARG MC_COMMIT=7394ce0dd2a80935aded936b09fa12cbb3cb8096

# The commit check fails the build loudly if a tag ever gets moved upstream -
# same reasoning as the sha256 checks on the `age` release download in
# backup.Dockerfile - rather than silently building whatever HEAD of the tag
# now points to.
RUN git clone --depth 1 --branch "${MINIO_VERSION}" https://github.com/minio/minio.git /src/minio \
 && cd /src/minio \
 && test "$(git rev-parse HEAD)" = "${MINIO_COMMIT}"
WORKDIR /src/minio
RUN MINIO_RELEASE=RELEASE go build -trimpath -tags kqueue \
      -ldflags "$(MINIO_RELEASE=RELEASE go run buildscripts/gen-ldflags.go)" \
      -o /out/minio . \
 && /out/minio --version

RUN git clone --depth 1 --branch "${MC_VERSION}" https://github.com/minio/mc.git /src/mc \
 && cd /src/mc \
 && test "$(git rev-parse HEAD)" = "${MC_COMMIT}"
WORKDIR /src/mc
RUN MC_RELEASE=RELEASE go build -trimpath -tags kqueue \
      -ldflags "$(MC_RELEASE=RELEASE go run buildscripts/gen-ldflags.go)" \
      -o /out/mc . \
 && /out/mc --version

# alpine:3.22, digest pinned. Both final images ship `mc` (compose.dev.yml's
# minio healthcheck runs `mc ready local` from inside the server container,
# matching the official image's own bundling of both binaries).
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8 AS minio
RUN apk add --no-cache ca-certificates \
 && addgroup -S minio -g 1001 && adduser -S minio -G minio -u 1001 -h /home/minio
COPY --from=build /out/minio /usr/bin/minio
COPY --from=build /out/mc /usr/bin/mc
RUN mkdir -p /data && chown -R minio:minio /data /home/minio
USER minio
ENV HOME=/home/minio
VOLUME ["/data"]
EXPOSE 9000
ENTRYPOINT ["minio"]

FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8 AS mc
RUN apk add --no-cache ca-certificates \
 && addgroup -S mc -g 1001 && adduser -S mc -G mc -u 1001 -h /home/mc
COPY --from=build /out/mc /usr/bin/mc
USER mc
ENV HOME=/home/mc
ENTRYPOINT ["mc"]
