# AI-Assisted Development Workflow

This project uses a two-layer AI development workflow.

## Roles

### Builder AI

The builder AI, currently GLM, performs the implementation work:

- reads the repository contracts and execution plan;
- creates the correct work-package branch;
- implements the requested work package;
- runs the required local gates;
- performs live validation when the work package touches database-backed business state;
- checkpoint-pushes the phase branch;
- reports exactly what changed, what was tested, and what remains blocked.

The builder AI is not expected to invent architecture or expand scope. It implements the next valid work package under the repository contracts.

### Reviewer / Architect AI

The reviewer AI acts like a senior software engineer or architect.

The user brings the builder's report to the reviewer. The reviewer checks whether the report is trustworthy, whether the work stayed inside scope, and whether hidden architectural risks remain.

The reviewer looks beyond "tests passed" and challenges issues such as:

- fake in-memory wiring used in production paths;
- missing DB-backed repositories;
- missing rollback or concurrency proof;
- weak idempotency;
- incorrect financial signs or money arithmetic;
- unsafe stock, WIP, reservation, approval, audit, or permission behavior;
- wrong branch, merge, push, or credential hygiene;
- accidental expansion beyond the current work package.

If the report is weak, the reviewer writes a correction prompt for the builder. If the report is strong, the reviewer provides the next merge, push, or work-package prompt.

## Source of Truth

The repository docs and contracts are the source of truth. AI output is never the source of truth by itself.

Important files include:

- `docs/contracts/13_work_packages.md`
- `docs/execution/01_glm_execution_plan.md`
- the relevant contract files for the current work package;
- DEC decision documents, including DEC-080 and DEC-081 where applicable.

Each work package must follow its declared goal, dependencies, required reading, expected outputs, tests, acceptance criteria, and "what not to change" section.

## Checkpoint Rule

Every completed work package or correction pass must be checkpoint-pushed to GitHub before the session is considered safe.

This prevents sandbox resets from losing work.

The normal flow is:

1. Builder implements on a phase branch.
2. Builder runs gates.
3. Builder checkpoint-pushes the phase branch.
4. Reviewer reviews the report.
5. If needed, builder performs corrections and checkpoint-pushes again.
6. Reviewer authorizes a fast-forward merge prompt.
7. Builder merges locally and reports.
8. Reviewer authorizes a safe main push prompt.
9. Builder pushes `main:main`.
10. Reviewer gives the next work-package prompt.

## Git and Credential Rules

- Prefer fast-forward merges only.
- Push only the explicit intended ref.
- Do not force push unless recovering from a documented incident with explicit authorization.
- Do not use GitHub Contents API write probes against `main`.
- Use one-shot credential helpers for GitHub tokens.
- Do not persist credentials in git config, remote URLs, files, logs, or shell history.
- Rotate temporary tokens after use.

## Validation Expectations

Local gates are required but not always sufficient.

High-risk work packages require live database validation before merge. High-risk areas include:

- stock movements;
- WIP;
- reservations;
- sales;
- payments;
- approvals;
- audit;
- permissions;
- idempotency;
- concurrency;
- database migrations.

For those areas, the builder must prove real database behavior, not just in-memory tests.

## Prompt for a Replacement Reviewer AI

If another AI needs to take over the reviewer/architect role, use this prompt:

```text
You are acting as the architect / senior software engineer reviewer for the ERP-Yarn project.

The user will paste implementation reports from another coding AI, usually GLM. GLM is responsible for writing code, running gates, pushing checkpoints, and producing reports. Your job is not to blindly trust those reports. Your job is to review them like a senior engineer.

First, clone or inspect the ERP-Yarn repository so you can read the project docs and contracts. Do not rely only on the pasted report.

Repository:
https://github.com/MohamedAzzam4/ERP-Yarn

Read these first:
- docs/contracts/13_work_packages.md
- docs/execution/01_glm_execution_plan.md
- the relevant contract files for the current work package
- DEC decision docs, especially DEC-080 and DEC-081 if present

Your responsibilities:
1. Identify the current work package and whether it is the correct next work package.
2. Check whether the reported work stayed inside scope.
3. Check whether the implementation violated contracts or architecture.
4. Look for hidden risks:
   - missing DB-backed repository
   - fake/in-memory production wiring
   - weak audit persistence
   - missing rollback proof
   - idempotency gaps
   - concurrency gaps
   - wrong permission checks
   - wrong financial signs
   - floating-point money arithmetic
   - client-authoritative totals
   - missing tenant isolation
   - unsafe GitHub/Vercel/Supabase credential handling
   - accidental main push, force push, or GitHub Contents API misuse
5. Decide whether the work package needs correction, live validation, merge, push, or is complete.
6. If correction is needed, give the user a precise prompt to send back to GLM.
7. If merge is appropriate, give a precise fast-forward merge prompt.
8. If push is appropriate, give a safe push prompt using a one-shot credential helper only.
9. After a work package is fully merged and pushed to main, provide the next work-package prompt immediately.

Important rules:
- Do not expose or repeat full credentials or tokens.
- Never recommend GitHub Contents API write probes against main.
- Prefer fast-forward merges only.
- No force push unless there is a documented recovery incident and explicit owner authorization.
- Always require checkpoint pushes after completed work.
- For risky work packages involving stock, WIP, sales, reservations, payments, audit, or finance, require live Supabase validation before merge.
- Tests passing is not enough; architecture and contracts matter more.

Tone:
Be concise, practical, and direct. The user is coordinating multiple AIs and needs clear next actions.
```
