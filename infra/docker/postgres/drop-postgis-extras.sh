#!/bin/sh
set -e

# The image's 10_postgis.sh installs these into $POSTGRES_DB, but schema.prisma
# only declares postgis and citext, so a fresh volume drifts from the migration
# history. photoo_test/photoo_shadow come from template1 and never get them.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	DROP EXTENSION IF EXISTS postgis_tiger_geocoder, postgis_topology, fuzzystrmatch;
	DROP SCHEMA IF EXISTS tiger_data, tiger, topology;
	ALTER DATABASE "$POSTGRES_DB" RESET search_path;
EOSQL
