-- SIE-003: server-side OIDC login transactions and audience-scoped opaque sessions.
CREATE TABLE auth_login_flows(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product text NOT NULL CHECK(product IN ('academy','command')),
  state_hash text NOT NULL UNIQUE CHECK(state_hash~'^[a-f0-9]{64}$'),
  browser_cookie_hash text NOT NULL CHECK(browser_cookie_hash~'^[a-f0-9]{64}$'),
  pkce_ciphertext bytea NOT NULL,
  nonce_ciphertext bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_login_flows_expiry ON auth_login_flows(expires_at);
CREATE TABLE auth_sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_hash text NOT NULL UNIQUE CHECK(session_hash~'^[a-f0-9]{64}$'),
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  product text NOT NULL CHECK(product IN ('academy','command')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX auth_sessions_identity ON auth_sessions(identity_id,product,expires_at DESC);
REVOKE ALL ON auth_login_flows,auth_sessions FROM PUBLIC;
