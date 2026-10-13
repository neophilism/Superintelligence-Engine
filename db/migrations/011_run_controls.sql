-- SIE-017: explicit cancellation is a terminal local job state.
-- Provider-dispatched work is never moved here without separate reconciliation.
ALTER TABLE workflow_jobs DROP CONSTRAINT workflow_jobs_state_check;
ALTER TABLE workflow_jobs ADD CONSTRAINT workflow_jobs_state_check
 CHECK(state IN ('pending','ready','blocked_policy','leased','dispatched','needs_reconciliation','succeeded','failed','cancelled'));
