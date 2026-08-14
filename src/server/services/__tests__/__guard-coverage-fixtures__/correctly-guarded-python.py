#!/usr/bin/env python3
"""
FIXTURE — correctly guarded Python script.

Used by wp-08-01f-static-guard-coverage.test.ts to prove the validator
accepts a Python script that invokes the centralized guard CLI via
subprocess BEFORE any DELETE statement.

This file is NOT executed; the static-guard-coverage test reads its
source as text.
"""
import os
import subprocess
import psycopg2

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_TENANT_ID = "cccccccc-0000-4000-8000-000000000052"  # test-scoped, non-QA


def main():
    # Invoke the centralized guard CLI BEFORE connecting to the DB.
    subprocess.run(
        ["node", "scripts/wp-08-01f-destruction-guard.mjs"],
        check=True,
    )

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("DELETE FROM import_batches WHERE tenant_id = %s", (TEST_TENANT_ID,))
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
