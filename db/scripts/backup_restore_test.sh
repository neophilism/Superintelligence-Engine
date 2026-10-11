#!/usr/bin/env bash
set -euo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is required}"
command -v pg_dump
command -v psql
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
pg_dump --dbname="$TEST_DATABASE_URL" --no-owner --no-acl --format=plain --file="$dir/backup.sql"
psql "postgres://postgres:postgres@127.0.0.1:5432/postgres" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS sie_restored" >/dev/null
psql "postgres://postgres:postgres@127.0.0.1:5432/postgres" -v ON_ERROR_STOP=1 -c "CREATE DATABASE sie_restored" >/dev/null
psql "postgres://postgres:postgres@127.0.0.1:5432/sie_restored" -v ON_ERROR_STOP=1 -f "$dir/backup.sql" >/dev/null
restored="$(psql "postgres://postgres:postgres@127.0.0.1:5432/sie_restored" -At -c "SELECT count(*) FROM public.tenants")"
migrations="$(psql "postgres://postgres:postgres@127.0.0.1:5432/sie_restored" -At -c "SELECT count(*) FROM public.schema_migrations")"
test "$restored" -ge 2
test "$migrations" -ge 1
echo "Verified separate-database PostgreSQL backup restore"
