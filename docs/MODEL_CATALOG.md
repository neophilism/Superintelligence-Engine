# SIE-010 Provider/model capability catalog

Read-only catalog lists exact provider/model revisions, operations, modalities, regions, licensing, pricing certainty, health and availability reasons. Unknown pricing, old health observations, missing provider adapters, disallowed regions or rights and disabled records cannot be advertised as operational. No models are seeded as healthy without observations. Models are stored in PostgreSQL and never grant tool privileges or provider credentials. The API uses an optional dedicated `MODEL_CATALOG_READ_URL` PostgreSQL connection and responds 503 if unconfigured, not simulated success. SIE-011 must configure real provider adapters and health before marking any model available.

`/v1/models` is public metadata only. Credentials, tenant project usage and billable operations remain protected behind future auth and ledger implementation.
