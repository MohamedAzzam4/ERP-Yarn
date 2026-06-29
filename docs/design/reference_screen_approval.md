# Reference Screen Approval Record

## 1. Status

No reference screen is approved yet.

This file is the canonical repository approval record for the reference-screen gate. It resolves the storage/sign-off mechanism required by `PCD-UX-002`, but it does not itself approve any screen until the owner records a decision below.

## 2. Approval Mechanism

Reference-screen approval is versioned, not permanent.

For each approval version, store:

- fixture version;
- screen version;
- screenshot or equivalent visual evidence path;
- palette/token notes;
- typography and density notes;
- accepted breakpoints;
- Arabic/RTL/LTR behavior notes;
- accessibility and reduced-motion notes;
- known limitations;
- owner decision;
- decision date.

Evidence should be stored under:

```text
docs/design/evidence/reference-screens/<version>/
```

If screenshots are too large for the repository, store a concise repository note with stable external evidence location and checksum/metadata. Do not store secrets, real client data, production data or private credentials in approval evidence.

## 3. Change Policy

Changing screens later does not break the ERP if the change is handled through a new version.

- Visual-only changes require visual, responsive, accessibility and regression evidence.
- Business behavior, permission behavior, API fields, command semantics or data meanings require contract and test updates.
- Worker financial redaction, backend authorization and domain contracts remain binding regardless of visual approval.

## 4. Approval Records

### reference-screens-v1

| Screen | Fixture version | Evidence path | Owner decision | Date | Notes |
| --- | --- | --- | --- | --- | --- |
| Worker raw-material receipt | reference-fixtures-v1 | Unresolved / requires owner decision | Not approved | Unresolved / requires owner decision | Build reference first. |
| Accountant review queue | reference-fixtures-v1 | Unresolved / requires owner decision | Not approved | Unresolved / requires owner decision | Build reference first. |
| Owner dashboard | reference-fixtures-v1 | Unresolved / requires owner decision | Not approved | Unresolved / requires owner decision | Build reference first. |
