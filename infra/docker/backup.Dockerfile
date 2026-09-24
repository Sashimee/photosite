# syntax=docker/dockerfile:1
# Build context is the monorepo root: docker build -f infra/docker/backup.Dockerfile .
#
# Same postgis/postgis digest as infra/dokploy/preview/compose.yml's `postgres`
# service, so pg_dump/pg_restore match the server exactly
# (docs/steps/1E.3-backups.md). That base is Debian 11 (bullseye), past its
# security-archive retention on deb.debian.org (`apt-get install` there 404s
# on this date), and has no `age` package regardless - so `age` and `mc` are
# fetched in separate, currently-supported builder stages and copied in as
# binaries; the postgis base layer itself never runs apt-get.

# Built from source and mirrored to GHCR (#326): MinIO Inc. archived
# github.com/minio/{minio,mc} and cut off anonymous pulls of their own
# quay.io images - see infra/docker/minio-mirror.Dockerfile's comment.
FROM ghcr.io/sashimee/mc:RELEASE.2025-08-13T08-35-41Z@sha256:a0b9f1a75dc9ca1e96db9055a391bbf72ffbf7e9e5d3329e506fdcf4149cdbd3 AS mc

FROM curlimages/curl:8.22.0@sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777 AS age-fetch
ARG AGE_VERSION=1.3.2
ARG AGE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10
RUN curl -fsSL -o /tmp/age.tar.gz \
      "https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz" \
  && echo "${AGE_SHA256}  /tmp/age.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/age.tar.gz -C /tmp

FROM postgis/postgis:16-3.5@sha256:94146ac37bc61e2322f88016056c5920729cb8c64c8542ed590af8fc2abdac07 AS runtime
COPY --from=mc /usr/bin/mc /usr/local/bin/mc
COPY --from=age-fetch /tmp/age/age /tmp/age/age-keygen /usr/local/bin/
COPY infra/dokploy/backup/backup.sh infra/dokploy/backup/prune.sh infra/dokploy/backup/schedule.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/age /usr/local/bin/age-keygen \
      /usr/local/bin/backup.sh /usr/local/bin/prune.sh /usr/local/bin/schedule.sh
# `postgres` (uid 999) already exists in the base image for the server
# process to drop root privileges to; reused here so this image needs no
# user of its own.
USER postgres
ENTRYPOINT ["/usr/local/bin/schedule.sh"]
