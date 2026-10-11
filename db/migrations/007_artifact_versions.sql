CREATE TABLE project_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 project_id uuid NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 256),
 current_revision integer NOT NULL DEFAULT 1 CHECK(current_revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX project_artifacts_project ON project_artifacts(tenant_id,project_id,created_at);
CREATE TABLE artifact_revisions (
 tenant_id uuid NOT NULL,
 artifact_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 media_type text NOT NULL CHECK(length(media_type) BETWEEN 3 AND 160),
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 body jsonb,
 asset_id uuid,
 rights jsonb NOT NULL DEFAULT '{}'::jsonb,
 provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_by uuid NOT NULL REFERENCES identities(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,artifact_id,revision),
 FOREIGN KEY(tenant_id,artifact_id) REFERENCES project_artifacts(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,asset_id) REFERENCES asset_metadata(tenant_id,id),
 CHECK((body IS NOT NULL AND asset_id IS NULL) OR (body IS NULL AND asset_id IS NOT NULL))
);
CREATE INDEX artifact_revisions_created ON artifact_revisions(tenant_id,artifact_id,created_at);
REVOKE ALL ON project_artifacts,artifact_revisions FROM PUBLIC;
ALTER TABLE project_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE artifact_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY project_artifacts_read ON project_artifacts FOR SELECT
 USING (tenant_id=sie.current_tenant() AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=project_artifacts.tenant_id AND m.identity_id=sie.current_identity()));
CREATE POLICY project_artifacts_insert ON project_artifacts FOR INSERT
 WITH CHECK(tenant_id=sie.current_tenant() AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=project_artifacts.tenant_id AND m.identity_id=sie.current_identity() AND m.role IN ('owner','admin','member')));
CREATE POLICY project_artifacts_update ON project_artifacts FOR UPDATE
 USING(tenant_id=sie.current_tenant() AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=project_artifacts.tenant_id AND m.identity_id=sie.current_identity() AND m.role IN ('owner','admin','member')))
 WITH CHECK(tenant_id=sie.current_tenant() AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=project_artifacts.tenant_id AND m.identity_id=sie.current_identity() AND m.role IN ('owner','admin','member')));
CREATE POLICY artifact_revisions_read ON artifact_revisions FOR SELECT
 USING (tenant_id=sie.current_tenant() AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=artifact_revisions.tenant_id AND m.identity_id=sie.current_identity()));
CREATE POLICY artifact_revisions_insert ON artifact_revisions FOR INSERT
 WITH CHECK(tenant_id=sie.current_tenant() AND created_by=sie.current_identity() AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=artifact_revisions.tenant_id AND m.identity_id=sie.current_identity() AND m.role IN ('owner','admin','member')));
