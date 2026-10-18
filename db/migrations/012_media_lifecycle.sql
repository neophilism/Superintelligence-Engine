CREATE TABLE media_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 provider_id text NOT NULL,provider_task_id text NOT NULL,
 modality text NOT NULL CHECK(modality IN ('image','music','video')),
 reservation_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','failed','cancelled')),
 output jsonb,rights jsonb,actual_micro bigint CHECK(actual_micro>=0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider_id,provider_task_id),UNIQUE(tenant_id,reservation_id),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES budget_reservations(tenant_id,id)
);
CREATE TABLE media_callbacks (
 provider_id text NOT NULL,callback_id text NOT NULL,task_id uuid NOT NULL REFERENCES media_tasks(id) ON DELETE CASCADE,
 digest text NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(provider_id,callback_id)
);
REVOKE ALL ON media_tasks,media_callbacks FROM PUBLIC;
ALTER TABLE media_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE media_callbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_callbacks FORCE ROW LEVEL SECURITY;
