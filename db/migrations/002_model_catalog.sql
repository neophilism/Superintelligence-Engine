CREATE TABLE IF NOT EXISTS provider_models(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 80),
  model text NOT NULL CHECK(length(model) BETWEEN 1 AND 160),
  revision text NOT NULL CHECK(length(revision) BETWEEN 1 AND 160),
  operations text[] NOT NULL DEFAULT '{}',
  modalities text[] NOT NULL DEFAULT '{}',
  regions text[] NOT NULL DEFAULT '{}',
  license_scope text NOT NULL DEFAULT 'none' CHECK(license_scope IN ('none','personal','commercial')),
  price_status text NOT NULL DEFAULT 'unknown' CHECK(price_status IN ('known','unknown')),
  price_microunits bigint CHECK(price_microunits>=0),
  price_unit text,
  health_status text NOT NULL DEFAULT 'unknown' CHECK(health_status IN ('healthy','degraded','outage','unknown')),
  health_observed_at timestamptz,
  adapter_configured boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,model,revision)
);
CREATE INDEX IF NOT EXISTS provider_models_operations ON provider_models USING gin(operations);
REVOKE ALL ON provider_models FROM PUBLIC;
-- Catalog contains only public integration metadata. Authorized read roles can be granted SELECT explicitly after provisioning.
