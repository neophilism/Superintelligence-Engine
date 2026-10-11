-- SIE-014. Starts at a global hard cap of ZERO; external billing/permissions must configure funds and limits.
CREATE TABLE budget_global (
  singleton int PRIMARY KEY DEFAULT 1 CHECK(singleton=1),
  hard_limit_micro bigint NOT NULL DEFAULT 0 CHECK(hard_limit_micro>=0),
  spent_micro bigint NOT NULL DEFAULT 0 CHECK(spent_micro>=0),
  reserved_micro bigint NOT NULL DEFAULT 0 CHECK(reserved_micro>=0),
  CHECK(spent_micro+reserved_micro<=hard_limit_micro)
);
INSERT INTO budget_global(singleton,hard_limit_micro) VALUES(1,0);
CREATE TABLE budget_accounts(
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  funded_micro bigint NOT NULL DEFAULT 0 CHECK(funded_micro>=0),
  hard_limit_micro bigint NOT NULL DEFAULT 0 CHECK(hard_limit_micro>=0),
  spent_micro bigint NOT NULL DEFAULT 0 CHECK(spent_micro>=0),
  reserved_micro bigint NOT NULL DEFAULT 0 CHECK(reserved_micro>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(spent_micro+reserved_micro<=funded_micro),
  CHECK(spent_micro+reserved_micro<=hard_limit_micro)
);
CREATE TABLE budget_reservations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES budget_accounts(tenant_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
  reserved_micro bigint NOT NULL CHECK(reserved_micro>0),
  charged_micro bigint NOT NULL DEFAULT 0 CHECK(charged_micro>=0),
  refunded_micro bigint NOT NULL DEFAULT 0 CHECK(refunded_micro>=0),
  status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','released')),
  provider_task_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK(charged_micro<=reserved_micro),
  CHECK(refunded_micro<=charged_micro),
  UNIQUE(tenant_id,idempotency_key),
  UNIQUE(tenant_id,id)
);
CREATE TABLE budget_events(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES budget_accounts(tenant_id) ON DELETE CASCADE,
  reservation_id uuid,
  event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 160),
  event_type text NOT NULL CHECK(event_type IN ('reserve','settle','release','refund','fund')),
  delta_reserved_micro bigint NOT NULL DEFAULT 0,
  delta_spent_micro bigint NOT NULL DEFAULT 0,
  delta_funded_micro bigint NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,event_key),
  CONSTRAINT budget_event_same_tenant FOREIGN KEY(tenant_id,reservation_id) REFERENCES budget_reservations(tenant_id,id)
);
CREATE INDEX budget_events_tenant_recent ON budget_events(tenant_id,recorded_at DESC);
REVOKE ALL ON budget_global,budget_accounts,budget_reservations,budget_events FROM PUBLIC;
ALTER TABLE budget_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE budget_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE budget_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_events FORCE ROW LEVEL SECURITY;
