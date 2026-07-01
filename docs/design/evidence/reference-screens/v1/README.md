# Reference Screen Approval Evidence — v1

This directory is the canonical evidence location for `reference-screens-v1` approval per `DEC-079`.

## Approval status

**APPROVED — 2026-07-01**

See `docs/design/reference_screen_approval.md` §4 for the full approval record.

## Evidence summary

Visual evidence was captured during validation passes against the deployed Vercel Preview. Screenshots are not committed to the repository (to avoid large binary blobs); the stable evidence references are:

| Evidence | Location |
| --- | --- |
| Approved Preview URL (dashboard) | `https://erp-yarn-git-phase-01-reference-screens-bundle-azzam-s-team.vercel.app/management/dashboard` |
| Approved Preview URL (review queue) | `https://erp-yarn-git-phase-01-reference-screens-bundle-azzam-s-team.vercel.app/management/reviews` |
| Approved Preview URL (worker receipt) | `https://erp-yarn-git-phase-01-reference-screens-bundle-azzam-s-team.vercel.app/worker/raw-receipts/new` |
| Approved commit | `040252ba23e9fa8abb1b1566a60b504183ac11eb` on `main` |
| Approved branch | `phase/01-reference-screens-bundle` |
| Validation worklog | `worklog.md` (WP-01-05/06/07 validation entries) |

If a future audit requires committed screenshots, add them to this directory without changing the approval record's semantic content in `docs/design/reference_screen_approval.md`.
