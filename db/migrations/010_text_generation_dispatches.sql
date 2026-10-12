-- SIE-012B: one reservation may dispatch only one provider generation.
CREATE TABLE text_generation_dispatches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 identity_id uuid NOT NULL REFERENCES identities(id),
 reservation_id uuid NOT NULL,
 provider_id text NOT NULL CHECK(length(provider_id) BETWEEN 2 AND 100),
 operation text NOT NULL CHECK(operation IN ('text.generate','reason.generate')),
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 output_limit int NOT NULL CHECK(output_limit BETWEEN 16 AND 4096),
 quoted_ceiling_micro bigint NOT NULL CHECK(quoted_ceiling_micro>0),
 state text NOT NULL CHECK(state IN ('dispatch_uncertain','completed','needs_reconciliation')),
 provider_response_id text,
 provider_model_revision text,
 artifact_id uuid,
 usage_input_tokens bigint CHECK(usage_input_tokens>=0),
 usage_output_tokens bigint CHECK(usage_output_tokens>=0),
 settled_micro bigint CHECK(settled_micro>=0),
 failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,reservation_id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES budget_reservations(tenant_id,id)
);
CREATE INDEX text_generation_dispatches_project_recent ON text_generation_dispatches(tenant_id,project_id,created_at DESC);
REVOKE ALL ON text_generation_dispatches FROM PUBLIC;
ALTER TABLE text_generation_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE text_generation_dispatches FORCE ROW LEVEL SECURITY;
