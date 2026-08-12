# WP-08-01F QA Manifest

## Evidence Status

### Proven (via browser QA)
- Supabase Auth login (Owner, Accountant, Worker)
- Batch creation with exact ID tracking
- Template selector (5 templates)
- CSV upload to private Supabase Storage (files + staging rows verified in DB)
- Finalize staging (batch transitioned source_uploaded → staged)
- Worker route denial (redirected to /worker)

### Attempted but Incomplete
- Full invalid-file validation UX (upload succeeded, validation not fully verified via browser)
- Corrected replacement flow (form not reached via browser)
- Reconciliation (form not submitted via browser)
- Dual approval (forms not submitted via browser)
- Commit (not reached)
- Correction (not reached)

### Not Tested via Browser (proven via PostgreSQL proof tests)
- Cell-level validation findings (27 PG proof tests pass)
- Immutable file replacement/preservation (27 PG proof tests pass)
- Concurrent validation/reconciliation rejection (12 PG proof tests pass)
- Cross-tenant isolation (PG proof test pass)
- Owner-token loss rollback (PG proof test pass)
- Replay zero-effect (PG proof test pass)

### Previous Runs
All previous browser QA runs are marked SUPERSEDED.
They are preserved only as debugging history, not as final evidence.

### Defects Found and Fixed During QA
1. `1daaf54` — import_cutover_locks query: desc() in WHERE not ORDER BY
2. `3b40cd5` — verifyBucket: direct fetch incompatible with new Supabase key format
3. `4f05f4b` — store/read/exists/delete: same key format incompatibility

### QA Harness
Committed at: `scripts/wp-08-01f-browser-qa/`
See README.md for resume instructions.
