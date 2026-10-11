# Engine foundation — SIE-001

Node 22+, zero mandatory provider secrets. Run `npm install --ignore-scripts`, `npm test`, `npm run check`, and `npm run release:dry-run`. Start the real health/capability API via `node apps/api/src/server.mjs`.

Structure: `apps/api` (HTTP boundary), `apps/worker` (future durable execution), `packages/core` (validated domain primitives), `packages/sdk` (typed client boundary). No model is provisioned: `/v1/capabilities` truthfully returns `generationEnabled:false`. CI checks the implementation.

Next: SIE-002 versioned OpenAPI contracts, then database, identities, permissions, provider routing and cost-safety. No claim of production readiness.
