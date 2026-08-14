#!/usr/bin/env bash
# FIXTURE — correctly guarded shell script.
#
# Used by wp-08-01f-static-guard-coverage.test.ts to prove the validator
# accepts a shell script that invokes the centralized guard CLI BEFORE
# any DELETE statement.
#
# This file is NOT executed; the static-guard-coverage test reads its
# source as text.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:?}"
TEST_TENANT_ID="cccccccc-0000-4000-8000-000000000052"  # test-scoped, non-QA

# Invoke the centralized guard CLI BEFORE any psql call.
node scripts/wp-08-01f-destruction-guard.mjs

psql "$DATABASE_URL" -c "DELETE FROM import_batches WHERE tenant_id = '$TEST_TENANT_ID'"
