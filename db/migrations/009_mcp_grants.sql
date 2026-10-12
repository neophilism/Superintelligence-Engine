-- SIE-019: audited per-user MCP consent. Server-side trusted broker only, default deny for public roles.
CREATE TABLE mcp_tool_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
 connection_id text NOT NULL CHECK(length(connection_id) BETWEEN 1 AND 100),
 resource_scope text NOT NULL CHECK(length(resource_scope) BETWEEN 1 AND 512),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 approved_at timestamptz NOT NULL DEFAULT now(),
 approval_source text NOT NULL CHECK(approval_source IN ('direct-user-consent')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_grants_scope_idx ON mcp_tool_grants(tenant_id,identity_id,connection_id,resource_scope,expires_at DESC) WHERE revoked_at IS NULL;
CREATE TABLE mcp_tool_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 identity_id uuid NOT NULL REFERENCES identities(id),
 connection_id text NOT NULL,
 resource_scope text NOT NULL,
 decision text NOT NULL CHECK(decision IN ('allowed','denied','failed')),
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 output_sha256 text,
 previous_sha256 text NOT NULL CHECK(previous_sha256 ~ '^[a-f0-9]{64}$'),
 event_sha256 text NOT NULL CHECK(event_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_audit_tenant_recent ON mcp_tool_audit(tenant_id,id DESC);
REVOKE ALL ON mcp_tool_grants,mcp_tool_audit FROM PUBLIC;
ALTER TABLE mcp_tool_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tool_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_tool_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tool_audit FORCE ROW LEVEL SECURITY;
