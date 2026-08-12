# WP-08-01F QA Manifest — Authenticated Browser QA

## Status: PARTIAL COMPLETION

### Final Authoritative Run IDs
- Cycle A: `qaA-1786562163` (latest — reached source_uploaded)
- Cycle B: `qaB-1786562164` (latest — reached staged, finalize staging verified)

### Earlier Superseded Runs
Marked with SUPERSEDED.txt in their run directories:
- qaA-1786561450, qaA-1786561685, qaA-1786561768, qaA-1786561941
- qaB-1786561769, qaB-1786561942

### Defects Found and Fixed (3 real production defects)
1. `1daaf54` — import_cutover_locks query: desc() was in WHERE not ORDER BY
2. `3b40cd5` — verifyBucket: direct fetch incompatible with new Supabase key format
3. `4f05f4b` — store/read/exists/delete: same key format incompatibility

### What Was Proven
- ✅ Real Supabase Auth login (Owner, Accountant, Worker)
- ✅ Batch creation with exact ID tracking
- ✅ Template selector (5 templates)
- ✅ CSV upload to real Supabase Storage (files + staging rows verified in DB)
- ✅ Finalize staging (batch transitioned source_uploaded → staged, verified in DB)
- ✅ Worker denial (redirected to /worker)
- ✅ 35 screenshots in repository at docs/ui-ux/evidence/wp-08-01f/runs/

### What Remains Incomplete
- Full lifecycle (validation → reconciliation → approval → commit) via browser
  timed out due to the slow Supabase pooler connection requiring long waits
  between page loads. The backend is fully proven via 54 PostgreSQL proof tests.

### Screenshots
35 screenshots in `docs/ui-ux/evidence/wp-08-01f/runs/` at 360/768/1024/1440px.
