-- SIE-016: privileged queue tables. Do not grant table access to public or untrusted web roles.
-- The worker must use a separately scoped trusted PostgreSQL principal; RLS denies access by default.
CREATE TABLE workflow_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 project_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES identities(id),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 128),
 recipe_sha256 text NOT NULL CHECK(recipe_sha256 ~ '^[a-f0-9]{64}$'),
 recipe jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','blocked','completed','failed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,request_key),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE workflow_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 run_id uuid NOT NULL,
 node_id text NOT NULL CHECK(length(node_id) BETWEEN 1 AND 64),
 operation text NOT NULL,
 effects text NOT NULL CHECK(effects IN ('read','generation','external')),
 dependencies jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(dependencies)='array'),
 state text NOT NULL CHECK(state IN ('pending','ready','blocked_policy','leased','dispatched','needs_reconciliation','succeeded','failed')),
 attempt int NOT NULL DEFAULT 0 CHECK(attempt>=0),
 max_attempts int NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 12),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 cost_ceiling_micro bigint NOT NULL DEFAULT 0 CHECK(cost_ceiling_micro>=0),
 approval_required boolean NOT NULL DEFAULT false,
 lease_owner text,lease_token uuid,lease_expires_at timestamptz,
 provider_dispatch_key text NOT NULL UNIQUE,
 provider_task_id text,
 checkpoint jsonb,
 result jsonb,
 failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,run_id,node_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES workflow_runs(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX workflow_jobs_ready_idx ON workflow_jobs(next_attempt_at,id) WHERE state='ready';
CREATE INDEX workflow_jobs_leased_idx ON workflow_jobs(lease_expires_at) WHERE state IN ('leased','dispatched');
CREATE INDEX workflow_jobs_run_idx ON workflow_jobs(run_id,state);
CREATE TABLE workflow_outbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 run_id uuid NOT NULL,
 event_key text NOT NULL UNIQUE,
 event_type text NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 claimed_by text,claimed_until timestamptz,delivered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,run_id) REFERENCES workflow_runs(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX workflow_outbox_pending_idx ON workflow_outbox(id) WHERE delivered_at IS NULL;
REVOKE ALL ON workflow_runs,workflow_jobs,workflow_outbox FROM PUBLIC;
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_outbox FORCE ROW LEVEL SECURITY;
