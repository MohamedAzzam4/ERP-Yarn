# Historical Migration Contract

## 1. Purpose

Define an implementation-safe historical migration pipeline for the Yarn Trading and Outsourced Manufacturing ERP. This contract prevents messy source workbooks, workbook-specific assumptions, unreviewed AI transformation, or ad hoc database changes from becoming operational truth.

Historical data becomes approved ERP history only after normalization, staging, validation, reconciliation, human review, separate Owner and Accountant approval, controlled commit through domain services, and locking.

## 2. Scope

This contract covers:

- the two-track historical migration strategy;
- normalized target templates and optional source adapters;
- optional AI-assisted transformation;
- source-file, cell, formula, transformation, and review provenance;
- staging structures and batch lifecycle;
- validation severity and logical-date rules;
- master-data extraction and alias approval;
- reconciliation reports and warning acceptance;
- dual approval and atomic historical commit;
- historical classification, locking, cost preservation, and profitability quality;
- post-commit correction/reversal/adjustment;
- permissions, API implications, audit, idempotency, backup, and tests.

The initial target period is 2025 and 2026 where source data is available and approved.

## 3. Non-Goals

- No permanent importer built around the currently known workbook layout.
- No direct Excel-, CSV-, AI-, script-, or browser-to-operational-table import.
- No automatic approval of inferred historical truth.
- No invention of missing prices, quantities, dates, parties, lots, locations, relationships, formulas, or balances.
- No conversion of imported historical cost into a live cost-override feature.
- No per-record daily operational approval for a committed historical batch.
- No direct editing, hard deletion, or silent database patching of committed history.
- No promise that messy historical data can be migrated without substantial human work.
- No multi-currency conversion or guessed exchange rate.
- No application code, database migration, route file, or frontend component in this documentation run.

## 4. Source Documents and Sections Used

This contract follows the canonical hierarchy in `docs/00_project_context.md`: explicit owner decisions, approved contracts, then v4 and the remaining authorized source pack. The sources below were used only to fill migration detail that does not conflict with that hierarchy:

- `07_Historical_Migration_Clarification.txt`;
- Final Implementation Plan v4 historical migration, schema, approval, audit, testing, backup, and rollout sections;
- Attack Review Integration Notes for corroborating migration-risk and logical-date detail;
- Architecture Blueprint v2 only as fallback context.

Binding upstream contracts:

- Decision Log: DEC-020–DEC-026, DEC-028–DEC-029 and Historical Migration, Imported Historical Cost Preservation, Backup/Restore, Approval/Audit decisions.
- Technical Architecture Contract: Supabase Storage, request-duration limits, server-only credentials, backup, and environment separation.
- Database Schema Contract §§5–7 and §§14–22.
- Inventory Posting Contract: ledger, negative-stock warning, reconciliation, correction, and idempotency rules.
- Production/WIP Contract: lineage and historical cost preservation.
- Approval Transaction Contract §§6–7, §14, and §15.
- Subledger and Costs Contract: immutable entries, signed balances, historical cost/profitability behavior.
- High-Risk API and Permission Matrix contracts.

Where the older Historical Migration Clarification proposes `approved_after_import_review`, this contract follows the later binding owner decision: use `approval_status = approved` with explicit historical/import metadata. The obsolete status must not be created.

## 5. Historical Migration Strategy

### 5.1 Track 1 — Normalized Historical Import Templates

The ERP defines versioned, normalized templates matching the target domain model. These are the preferred reviewed input format and must not mirror one workbook merely for convenience.

Templates cover, where data exists:

- suppliers, customers, locations, and external factories;
- fiber/product/quality masters and approved aliases;
- raw-material batches;
- single-yarn and twisted-yarn lots;
- inventory openings and movements by location;
- raw-material purchases/receipts;
- single-yarn and twisting production, WIP, output, and waste;
- sales and returns;
- customer, supplier, and factory payments/balances;
- quality tests, complaints, and direct costs.

Each template has a stable template name, version, field dictionary, required/optional rules, accepted units, date semantics, relationship keys, and target entity type. A template change creates a new version; it does not reinterpret already committed batches.

### 5.2 Track 2 — Optional Assisted Transformation

Messy or unofficial files may pass through a one-time/client-specific adapter or AI-assisted transformation into normalized templates. This track may identify table regions, map columns, normalize terminology, extract formulas, suggest aliases, detect duplicates, convert dates, and flag suspicious values.

It is preparation only. The current workbook is a candidate source and migration-risk example, not the permanent schema. Workbook-specific mapping remains isolated from core domain services and is versioned so it can be audited or discarded without changing the target model.

### 5.3 Mandatory Flow

```text
messy source files
→ optional AI-assisted or workbook-specific transformation
→ normalized import templates
→ staging tables
→ validation
→ reconciliation reports
→ human review
→ separate Owner + Accountant approval
→ approved historical import commit
→ locked historical records
→ later correction only through reversal/correction/adjustment
```

No step after source acquisition may be skipped because a file appears clean.

## 6. Key Entities

The schema contract controls final physical definitions. The migration subsystem requires these logical structures:

- `import_batches`: tenant, target period, state, template/mapping versions, counts, validation/reconciliation summary, approval and commit metadata;
- `import_files`: private source/normalized file metadata, storage reference, checksum, uploader, type, and batch;
- `import_template_versions`: normalized template schema/version and compatibility metadata;
- `import_staging_rows`: normalized candidate entity, source row, transformed values, state, warnings, reviewer, and target reference after commit;
- `import_staging_cells`: original value, formula, calculated value, transformed value, target field, transformation metadata, confidence, and review;
- `import_validation_errors`: rule code, severity, blocking flag, entity/field/source reference, message, and resolution/acceptance metadata;
- `import_reconciliation_results`: metric, source/expected/staged/committed values, difference, severity, reviewer decision, and report version;
- `import_human_review_items`: uncertainty, alias, formula, relationship, warning, or correction review task and decision;
- alias/master mappings: source value, normalized value, target master entity, confidence, status, approver, and version;
- approval records: separate Owner and Accountant decisions with actor/time/reason and reviewed report versions;
- audit and idempotency records;
- committed domain records and movements/entries/snapshots linked to the batch and source provenance;
- historical correction/reversal/adjustment records linked to the committed original.

Private files, normalized files, mapping manifests, validation reports, and reconciliation reports are operational artifacts that require backup. Supabase Storage is not itself a backup.

Real migration/pilot retention and independent backup location/period are blocked by PCD-FILE-001. Until resolved, source/evidence artifacts must not be deleted or treated as recoverable merely because they remain in operational object storage.

## 7. Required Fields and Structures

### 7.1 Required Import Provenance

Committed historical records must preserve these values directly or through an immutable, queryable source-provenance relationship:

```text
import_batch_id
source_file_name
source_sheet_name
source_row_number
source_column_mapping_version
imported_by
imported_at
validated_at
approved_by_owner
approved_by_accountant
approved_at
validation_status
reconciliation_status
warning_summary
```

Where a source cell matters to a business value, also preserve:

```text
source_column_name_or_index
original_cell_value
source_formula_text
source_calculated_value
normalized_or_transformed_value
normalized_template_name
normalized_template_version
transformation_type
transformation_version
transformation_notes
confidence_level
human_reviewer
review_status
```

Source filenames are display metadata; immutable file identity uses `import_file_id` plus checksum. A renamed file must not break provenance.

### 7.2 Historical Record Classification

Every committed historical domain record requires:

```text
approval_status = approved
record_period = historical
record_origin = excel_import | ai_assisted_import | manual_historical_entry
is_locked = true
import_batch_id = required
```

Do not create or use:

```text
approved_after_import_review
```

Historical rows do not pass through daily approvals individually. The import batch approval is the authorization, while the committed records retain their own classification and source links.

### 7.3 File and Version Integrity

Each uploaded source and normalized file records a cryptographic checksum, private storage reference, byte size, content type, uploader, upload time, batch, and replacement/supersession link. Re-uploading a corrected file creates a new version; it does not overwrite evidence used by an earlier validation or approval.

Validation, reconciliation, review, and approvals bind to exact file, template, mapping, and report versions. Any material staged-row/file/mapping change invalidates prior reconciliation and dual approvals and returns the batch to validation.

## 8. Core Rules

### 8.1 Staging Isolation

- Staging rows have no operational stock, WIP, reservation, account, payment, payable/receivable, profitability, or document-number effect.
- Staging may reference candidate master records but may not create active operational masters without the approved mapping/master workflow.
- Operational reports exclude staging except explicit migration previews.
- Staging data is tenant-scoped and cannot reference another tenant's master or source file.
- Validation/reconciliation jobs may be batched and resumable; retries must not duplicate findings or staged entities.

### 8.1.1 Cutover, Opening Balances and No-Double-Count Boundary

Each batch requires a versioned per-domain cutover manifest containing domain, inclusive/exclusive cutoff timestamp/date, import mode (`opening_balance`, `transaction_history`, or an explicitly approved hybrid), source coverage, opening-balance basis, live-system start boundary, and reconciliation owner.

DEC-071 resolves the MVP cutover model as opening balances only. Full transaction-history import is deferred unless separately approved. The validation engine must reject overlapping opening balances plus transactions/payments/movements that would recreate the same stock or party effect. Party opening balances cannot be combined with imported source sales/payments unless the manifest proves the non-overlapping boundary. Inventory openings cannot be combined with earlier movements that already derive those openings.

Incomplete production/WIP requires an explicit approved representation in the manifest/template: either opening WIP with source lineage and no duplicated issue, or imported production transactions that derive WIP. Coding agents must not invent a synthetic completed production order or payable to force reconciliation.

Historical source document numbers are stored as `source_document_no` provenance. Internal ERP `doc_no` uses an import-safe tenant/document sequence or namespace and must not collide with live numbers. The source number is never silently changed or used as an unconstrained internal key.

Final reconciliation/approval binds to the cutover manifest hash. During final validation and commit, an audited tenant/domain cutover lock prevents concurrent live postings in affected scopes. If the system cannot safely pause or serialize live writes, commit is blocked until an approved online-cutover design exists.

### 8.2 AI-Assisted Transformation Safety

- AI output never writes directly to operational tables and never calls the commit path.
- AI may create draft normalized values, mapping suggestions, confidence values, notes, and warnings only.
- AI must preserve source file/sheet/row/cell traceability and mapping/transformation version.
- AI must not invent missing prices, quantities, dates, identities, relationships, formulas, or balance explanations.
- An inferred value is explicitly marked as inferred and enters human review.
- Low-confidence, ambiguous, or materially transformed values enter `needs_human_review`.
- Unresolved critical errors are blocking.
- Human approval of one mapping/value does not authorize unrelated AI suggestions.

### 8.3 Formula Preservation

For formula-bearing cells preserve original displayed value, formula text, cached/calculated value where available, source coordinates, mapped ERP meaning, and warning/review status.

A formula result is not blindly treated as business truth. Hidden assumptions about yield, waste, consumption, production cost, prices, stock, or balances must be surfaced. The normalized imported value must state whether it came from the visible value, formula result, reviewed manual value, or another approved source.

### 8.4 Master Data Extraction and Alias Mapping

Embedded supplier, customer, factory, location, item, batch, and lot names are extracted as candidates. The process:

1. normalizes text only through versioned, non-destructive rules;
2. detects spelling/Arabic variations and possible duplicates;
3. suggests aliases without merging automatically;
4. requires Owner/Accountant review for ambiguous identity;
5. maps transactions only to approved canonical masters;
6. retains the original source label and approved alias decision.

No fuzzy match, AI confidence score, or identical-looking name may silently create or merge a master. Referenced master data remains inactive rather than hard-deleted when later superseded.

#### 8.4.1 Approval Unit

- The approval unit is an alias mapping group, not an individual staging row.
- Repeated occurrences belonging to the same reviewed mapping group are approved once.
- Do not require repeated human approval for every occurrence of the same alias.

#### 8.4.2 Authority

- One authorized Owner OR one authorized Accountant is sufficient to approve an alias mapping group.
- The same authorized reviewer may both select the target master and approve the mapping.
- No second actor is required merely because the first actor selected the mapping.

#### 8.4.3 DEC-080 Scope

Alias/master mapping review is not a high-risk approval request for purposes of DEC-080. DEC-080 requester-versus-approver self-approval restrictions do not apply to alias/master mapping confirmation.

This exception is limited to migration alias/master mapping review and does not change DEC-080 for high-risk approval workflows.

#### 8.4.4 Batch Approval Remains Separate

Alias mapping approval:

```text
Owner OR Accountant
one reviewer
mapping/review decision
```

Historical batch approval:

```text
Owner AND Accountant
separate approval stage
existing dual-approval/distinct-user rules remain unchanged
```

Alias approval is separate from migration batch approval and does not replace the required Owner AND Accountant dual approval for historical commit.

#### 8.4.5 Exceptions

- A reviewer may explicitly split rows into an exception/subgroup when context shows that the same source alias represents different canonical entities.
- Such exceptions/subgroups require their own reviewed mapping decisions.
- Group approval must not silently override an explicit exception.
- Source-row provenance remains preserved.

#### 8.4.6 Target Master

- The approved target must be an existing valid canonical master belonging to the correct tenant.
- AI/fuzzy matching/similarity may suggest candidates but may not approve, create, merge, or silently select the authoritative master.

#### 8.4.7 Missing Master

- If no correct canonical master exists, the alias remains unresolved.
- An unresolved required alias/master mapping blocks submission for approval.
- The official master must first be created through the normal Master Data workflow (DEC-083).
- Historical migration must not implement a separate hidden master-creation mechanism.

#### 8.4.8 Evidence / Versioning

An approved mapping preserves at least:

```text
source/normalized alias identity
target master
approving actor
approval time
mapping/version identity
```

A material mapping change invalidates dependent validation, reconciliation, relevant human review evidence, and approvals as applicable under the existing lifecycle contract.

### 8.5 Validation Severity

Every finding is one of:

- `blocking_error`: commit prohibited until corrected and revalidated;
- `review_required_warning`: commit prohibited until an authorized reviewer explicitly accepts or resolves it;
- `informational`: recorded but does not require acceptance.

Changing a blocking finding to a warning requires a documented rule or owner decision; users cannot downgrade severity ad hoc.

### 8.6 Required Validation Rules

Validation includes at least:

#### Required/type/unit validation

- required values and approval/provenance metadata;
- valid decimal values using contracted precision;
- kilogram quantities and explicit supported units;
- no floating-point business calculations;
- positive absolute transaction quantities with direction represented by the contracted movement/event;
- no impossible negative source quantities;
- current-client currency `EGP`; unsupported or ambiguous currency is blocking and no exchange rate is guessed.

#### Date validation

- valid, unambiguous date values;
- preservation of date-only semantics without timezone shift;
- dates not after the batch historical cutoff/commit time;
- sale not before receipt/availability unless explicitly accepted as historical inconsistency;
- production not before material availability;
- twisting not before single-yarn availability;
- return not before sale;
- payment and quality dates checked against related business context.

A future historical date is blocking. A logically inconsistent past sequence may become an accepted warning only with explicit review, reason, and dual approval.

#### Duplicate validation

- duplicate batch, lot, sale, payment, production, movement, return, and other document numbers;
- duplicate source file/checksum and duplicated source rows;
- duplicate normalized entities produced by multiple source rows;
- already-committed source provenance.

The same source row cannot create operational history twice. Confirmed duplicates are resolved or excluded explicitly; they are never silently dropped.

#### Master and relationship validation

- missing/unknown supplier, customer, factory, location, item, or account;
- unresolved/conflicting alias;
- invalid customer/supplier/factory reference;
- sale linked to unknown item/lot;
- invalid raw-message/batch to single-yarn-lot relationship;
- invalid single-yarn to twisted-yarn relationship;
- payment linked to unknown party/account;
- complaint/return linked to unknown sale/item where required;
- factory identity not linked to its inventory location;
- broken tenant identity.

#### Quantity, stock, cost, and balance validation

- impossible stock movements or quantity conservation failure;
- stock/location/factory/WIP balance mismatch;
- output/waste/input relationship inconsistency;
- suspicious or missing waste;
- negative resulting stock warning with affected item/location/date chain;
- customer, supplier, and factory balance mismatch;
- sales/payment/production/return total mismatch;
- missing price/cost and incomplete profitability;
- imported cost versus current-formula difference;
- formula/calculated/displayed-value inconsistency.

Negative resulting stock, historical balance differences, and cost/formula differences remain visible warnings and require explicit reviewed acceptance where the source cannot be corrected. They are never normalized silently.

### 8.7 Reconciliation Requirements

Versioned reconciliation reports compare source-authoritative totals, staged calculations, expected opening/closing values, and proposed operational effects. Reports include:

- raw-material balances;
- single-yarn balances;
- twisted-yarn balances;
- stock by item and location;
- stock held at each external factory;
- production/WIP totals;
- customer balances;
- supplier balances;
- factory balances;
- sales totals;
- payment totals;
- production totals;
- return totals;
- imported cost warnings and missing-cost/price counts;
- negative-stock warnings;
- unmatched/broken relationship records;
- unresolved aliases;
- duplicate source/normalized records;
- blocking-error, review-warning, and accepted-warning counts.

Owner and Accountant provide or approve the authoritative comparison totals. A report must expose exact differences and drill back to batch/file/sheet/row; a green summary cannot hide unmatched rows or accepted warnings.

### 8.8 Imported Historical Cost Preservation

For imported historical production:

- preserve `imported_total_factory_cost` exactly as approved from source;
- do not replace it with the live input-based formula;
- preserve formula text and source calculated value when available;
- calculate an ERP comparison using the current formula at high precision;
- store basis as `imported_excel`, `input_based`, `output_based`, `manual`, or `unknown`;
- store amount/percentage difference, warning, reviewer, and approval;
- route uncertain basis to Accountant Review.

The comparison is diagnostic only. It does not rewrite the imported value or authorize live cost overrides. Historical profitability is labeled imported/approximate/incomplete according to available source quality and retains missing-cost flags.

### 8.9 Human Review and Approval

Review queues include blockers, warnings, inferred values, low-confidence mappings, aliases, formulas, date inconsistencies, negative stock, balance mismatches, and cost differences.

Before submission for approval:

- no blocking errors remain;
- every review-required warning is resolved or explicitly accepted with reason;
- every required alias/master mapping group is approved by an authorized Owner or Accountant, every explicit exception/subgroup is separately resolved, and every approved mapping points to an existing valid canonical master;
- reconciliation report version is complete;
- source and normalized files are immutable/versioned;
- required backup evidence exists for real migration data.

Alias mapping confirmation is distinct from historical batch approval:

- Alias mapping: Owner OR Accountant; one mapping-review decision; the alias reviewer may have selected the target mapping themselves.
- Historical batch: Owner AND Accountant; separate dual-approval stage; existing dual-approval and distinct-user requirements under DEC-020 and DEC-069 remain unchanged.

DEC-080 self-approval segregation does not apply to alias/master mapping review. DEC-080 remains unchanged for high-risk approval workflows.

Commit requires two separate approval records: one by an authorized Owner and one by an authorized Accountant. Each approval binds to the same staged-data hash, cutover-manifest hash, mapping/template versions, validation result, reconciliation result, and warning summary. A later material change invalidates both approvals. DEC-069 requires the two approvals to come from two distinct user identities; one multi-role identity cannot satisfy both.

### 8.10 Approved Historical Commit

Commit is a high-risk, backend-only, idempotent transaction coordinated by the Migration service and existing domain posting services.

Preconditions:

- batch is approved for commit and not committed/rejected/cancelled;
- no blocking errors;
- all warnings accepted/resolved;
- Owner and Accountant approvals match the current versions/hash;
- backup exists for real migration data; only a documented demo-only waiver may bypass this for disposable demo data;
- idempotency key is valid;
- measured supported batch size fits the contracted transaction/request design;
- cutover manifest is approved and affected live-write scopes are locked/paused.

The commit:

1. locks batch, cutover scopes, approvals, idempotency, sequences, mappings, and affected domain rows in deterministic order;
2. rechecks every precondition and version/hash;
3. creates records through inventory, production, subledger, approval, and profitability domain services rather than table-copy logic;
4. applies approved historical opening/movement/account effects exactly once;
5. writes required provenance and historical classification;
6. stores approved warnings/cost comparisons;
7. sets committed records `is_locked = true`;
8. writes approval/commit audit in the same transaction;
9. marks the batch committed and stores effect counts/references;
10. commits all effects together.

A technical/system failure rolls back all operational effects and leaves the approved batch retryable; it does not create partial history. A business precondition discovered under lock prevents commit and records an audited failure/review result without operational posting.

The MVP commit is all-or-nothing for its supported batch size. The migration work package must benchmark representative rows/files/effects and record the maximum supported batch size, timeout margin and failure behavior before real data. If the batch cannot safely fit, coding must stop until a separately approved resumable, logically atomic design defines checkpoints, visibility, rollback and idempotency. A coding agent must not improvise partial commit.

### 8.11 Historical Locking and Correction

Committed records, movements, account entries, snapshots, source provenance, and accepted-warning evidence are immutable. Ordinary forms and import APIs cannot update or delete them.

Correction requires:

1. correction request linked to batch and original record;
2. reason and proposed domain correction;
3. dependency/reconciliation impact analysis;
4. Owner/Accountant review and renewed dual approval under DEC-070 where correction is post-commit;
5. linked reversal, correction, or inventory/account adjustment through domain services;
6. immutable audit and new reconciliation result where affected.

The original remains visible and locked. Developers and database administrators must not silently patch historical business values.

## 9. State Transitions

```text
draft
→ source_uploaded
→ normalized
→ staged
→ validation_in_progress
→ validation_complete
→ reconciliation_in_progress
→ review_required
→ pending_dual_approval
→ approved_for_commit
→ committing
→ committed
```

Allowed branches:

```text
source_uploaded → normalized | staged
review_required → normalized | staged | validation_in_progress
pending_dual_approval → review_required (material change or rejected approval)
approved_for_commit → review_required (stale version/new blocker)
draft/source_uploaded/normalized/staged/review_required/pending_dual_approval → cancelled
pending_dual_approval → rejected
```

Rules:

- `normalized` may be skipped only when a source already conforms to an approved normalized template; staging is never skipped.
- Validation or reconciliation execution failure records a retryable job failure without pretending the business state passed.
- One role approval does not make the batch approved; state becomes `approved_for_commit` only after both current approvals.
- Technical commit failure rolls back and returns/remains `approved_for_commit` for safe retry; it does not create a `committed` or generic business-failure state.
- `committed`, `rejected`, and `cancelled` are terminal for that batch. Corrections use linked records, not reopening the committed batch.

## 10. Permission Rules

- Workers cannot create approval decisions, commit imports, approve warnings, manage aliases, or edit committed history.
- Warehouse, Production, and Quality workers cannot access migration financial values, source files, reconciliation balances, or audit. Quality may access only explicitly assigned quality mapping under the permission matrix.
- Owner and Accountant may prepare/review according to `migration.prepare` and `migration.review`.
- Owner may review and approve alias mapping groups when otherwise authorized for migration review.
- Accountant may review and approve alias mapping groups when otherwise authorized for migration review.
- Only one of those roles is required for an individual alias mapping approval.
- The same reviewer may select and approve the target mapping.
- DEC-080 self-approval restrictions do not apply to this alias mapping confirmation.
- Workers cannot approve/manage alias mappings.
- This does not alter Owner + Accountant dual approval for the historical batch.
- Owner approval requires Owner authority; Accountant approval requires Accountant authority; both records are required.
- `migration.commit` executes only after both approvals and backend revalidation.
- Owner/Accountant may request correction before commit; material changes invalidate validation/reconciliation/approvals as applicable.
- After commit, correction/reversal permissions follow the affected domain and historical-correction contract.
- Source-file access uses private storage and server authorization or short-lived signed URLs.
- API responses and exports remain tenant- and field-filtered. Migration reports are internal reports, not backups.

## 11. API Implications

These are command/service contracts, not route-file authorization. Final paths must remain consistent with the High-Risk API Contract.

### 11.1 Create Import Batch

Owner/Accountant with `migration.prepare`; derives tenant/actor server-side; records target period, expected template/version, source description, and idempotency. Creates no operational effect.

### 11.2 Upload Source or Normalized Template

Authorized private upload associates checksum/file/version with the batch. Upload cannot claim validation, approval, or record origin. Replacements create new versions and invalidate dependent results.

### 11.3 Transform or Stage

Optional transformation records adapter/AI version, mapping version, confidence, and warnings. Staging accepts only supported normalized template versions and writes staging/provenance rows, never operational tables.

### 11.4 Run Validation

Runs deterministic versioned rules against the staged snapshot. Response/job result reports counts and references, not a client-calculated pass flag. Long-running work uses bounded jobs/batches or an authorized administrative process.

### 11.5 Run Reconciliation

Uses server calculations and approved comparison totals. Produces a versioned report with exact differences, warnings, and drill-through references. Client requests cannot submit calculated stock/account outcomes as authority.

### 11.6 Submit for Review and Decide Review Items

Submission requires validation/reconciliation completion. Review decisions require reason, permission, finding/version reference, and audit. A client cannot downgrade a blocking rule.

### 11.7 Owner and Accountant Approval

Separate idempotent commands record one Owner and one Accountant decision against the exact batch snapshot/report versions. Request bodies cannot claim role, actor, tenant, or calculated approval eligibility.

### 11.8 Commit Approved Import

Existing command:

```text
POST /api/v1/migration/import-batches/:batchId/commit
permission: migration.commit
```

The request contains confirmation/idempotency only, never staged/transformed rows. Transaction behavior is §8.10 and Approval Transaction Contract §15.

### 11.9 Reject or Cancel Batch

Requires reason, allowed state, permission, idempotency, and audit. It changes batch state only and creates no operational reversal because an uncommitted batch has no operational effects. A committed batch cannot be cancelled.

### 11.10 Correct Committed History

Creates a linked correction request and invokes the affected domain correction/reversal/adjustment after approval. No generic historical-row patch endpoint is allowed.

## 12. Testing Requirements

### 12.1 Isolation and Security

- Upload, transformation, normalization, staging, validation, and reconciliation do not change operational stock, WIP, reservations, accounts, payments, payables/receivables, or profitability.
- Cross-tenant batch/file/row/master references are rejected.
- Workers cannot approve, commit, read restricted migration financial data, or edit committed history.
- Private source files are inaccessible without authorized server checks/signed access.

### 12.2 Provenance and AI Safety

- Source file/sheet/row/cell, mapping/template/AI versions, original/formula/calculated/transformed values, confidence, and review metadata survive staging and commit.
- AI-transformed data cannot commit without normalized staging, validation, reconciliation, human review, and dual approval.
- Low-confidence/inferred data enters review; AI cannot invent missing facts silently.
- File replacement or staged-value change invalidates dependent validation, reconciliation, and approvals.

### 12.3 Validation and Reconciliation

- Missing required fields, impossible negative quantities, unsupported units, currency mismatch, unresolved required masters, broken lineage, and duplicate effective source rows block commit.
- Duplicate document numbers and already-committed source provenance are detected.
- Future historical dates are blocked; logical sequence inconsistencies are warned/reviewed.
- Raw, single-yarn, twisted-yarn, location/factory stock, party balances, sales, payments, production, returns, duplicates, unmatched records, and warnings reconcile visibly.
- Seeded balance mismatch, negative stock, cost mismatch, and unmatched alias appear in reports and audit; none is hidden by totals.
- Opening balances plus imported transactions/payments/movements cannot double count the same effect.
- WIP opening representation reconciles without a duplicated issue, receipt or payable.
- Historical source document numbers remain preserved while internal document numbers cannot collide with live sequences.

### 12.4 Approval and Commit

- Owner approval alone and Accountant approval alone cannot commit.
- Both current approvals are required and bind to the same snapshot/hash/report versions.
- Commit without backup evidence is rejected for real migration data.
- Commit is idempotent; same key/request returns the prior result and changed payload conflicts.
- Concurrent commit attempts create one effective history set.
- Concurrent live posting in an affected cutover scope is blocked/serialized and cannot cross the approved boundary.
- Representative maximum batch-size/timeout tests produce a documented safe ceiling before real migration.
- Injected domain/audit/transaction failure leaves no partial operational records and keeps the batch safely retryable.
- Committed records contain required classification/provenance and are locked.
- `approved_after_import_review` is rejected as an invalid status.

### 12.5 Historical Cost and Correction

- Imported historical cost remains unchanged after commit.
- Current live formula comparison creates warning/difference only and cannot overwrite imported cost.
- Historical profitability carries imported/approximate/incomplete quality and missing flags as applicable.
- Post-commit correction creates linked reversal/correction/adjustment, preserves original, updates reconciliation where needed, and audits.
- Direct form/API/database update of committed historical business values is rejected/detected.
- Historical correction remains blocked until renewed dual approval under DEC-070 is satisfied.

## 13. Common Failure Cases

Treating the current workbook as permanent schema; copying spreadsheet columns directly into domain tables; AI-to-operational import; staging bypass; source coordinates removed; formula result trusted without formula provenance; fuzzy aliases auto-merged; duplicate rows silently dropped; future or illogical dates ignored; source negative quantity treated as movement direction; currency converted using a guessed rate; balance mismatch hidden in an aggregate; imported cost recalculated with live formula; warning accepted without reason; approvals surviving changed data; one approval treated as dual approval; long Vercel request performing unbounded work; partial commit; direct historical edit; deleted source artifacts; export treated as backup.

## 14. Acceptance Criteria

- Two-track migration and normalized template boundaries are explicit.
- The current workbook remains a candidate source, not core schema.
- No source or AI output can bypass staging, validation, reconciliation, review, and dual approval.
- Required source/cell/formula/transformation metadata is preserved and queryable after commit.
- Validation severity, logical dates, duplicates, units, currency, relationships, quantities, costs, and balances are deterministic.
- Reconciliation exposes every required domain total, warning, unmatched record, duplicate, and negative-stock condition.
- Owner and Accountant approve the same immutable batch/report versions.
- Commit uses domain services, locks/idempotency/audit, and all-or-nothing behavior for supported size.
- Committed rows are classified `approved`/`historical`/import-origin, batch-linked, and locked.
- Imported Historical Cost Preservation cannot alter live costing.
- Corrections preserve the original through linked controlled effects.
- Permission, tenant, file privacy, backup, and worker financial restrictions remain intact.

## 15. Notes for AI Coding Agents

Do not import messy Excel directly into operational tables. Do not make the current workbook the permanent schema. Do not trust or commit AI-transformed data without normalized staging, deterministic validation, reconciliation, human review, and both approvals. Do not invent missing facts. Do not remove source-row/cell/formula traceability. Do not hide warnings, mismatches, negative stock, aliases, or duplicates. Do not treat accepted warnings as clean data. Do not create `approved_after_import_review`. Do not recalculate imported historical cost silently. Do not edit committed history directly. Do not build partial commit because a request is too large; stop and require an approved resumable logical-atomic design. If any material mapping, severity, authoritative total, or correction effect is undefined, write: **Unresolved / requires owner decision**.
