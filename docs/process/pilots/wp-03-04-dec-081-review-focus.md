# WP-03-04 DEC-081 Pilot Review Focus

## Status

Temporary package-specific guidance for blind review of WP-03-04. This file is not a permanent DEC-081 rule and does not alter WP-03-04 scope or domain contracts.

## Review Focus

Pay special attention to:

- persistent audit wiring versus in-memory audit stores;
- real `audit_logs` row creation;
- transaction coupling between sale failure resolution, reservation status, operational alert, and audit;
- no state change for technical/system failures;
- reason-specific reservation behavior;
- no automatic general release;
- duplicate/concurrent resolution prevention;
- no sale posting, stock movement, payment, or account entry side effects;
- whether operational alerts are internal DB rows only or imply external notification behavior.

Record Stage 1 and Stage 2 evidence using the paths and immutability rules in the DEC-081 engineering constitution.
