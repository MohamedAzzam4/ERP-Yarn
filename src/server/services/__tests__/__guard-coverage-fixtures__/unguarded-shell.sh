#!/usr/bin/env bash
# FIXTURE — intentionally UNGUARDED shell script.
#
# Used by wp-08-01f-static-guard-coverage.test.ts to prove the validator
# rejects a shell script that contains a DELETE statement but does NOT
# invoke the centralized guard CLI.
#
# This file is NOT executed; the static-guard-coverage test reads its
# source as text.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:?}"
TEST_TENANT_ID="00000000-0000-0000-0000-000000081e50"  # INTENTIONALLY UNGUARDED

psql "$DATABASE_URL" -c "DELETE FROM import_batches WHERE tenant_id = '$TEST_TENANT_ID'"
