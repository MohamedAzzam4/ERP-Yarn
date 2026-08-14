#!/usr/bin/env python3
"""
FIXTURE — intentionally UNGUARDED Python script.

Used by wp-08-01f-static-guard-coverage.test.ts to prove the validator
rejects a Python script that contains a DELETE statement but does NOT
invoke the centralized guard CLI.

This file is NOT executed; the static-guard-coverage test reads its
source as text.
"""
import os
import psycopg2

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_TENANT_ID = "00000000-0000-0000-0000-000000081e50"  # INTENTIONALLY UNGUARDED


def main():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("DELETE FROM import_batches WHERE tenant_id = %s", (TEST_TENANT_ID,))
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
