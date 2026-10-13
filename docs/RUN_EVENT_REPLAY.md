# SIE-017 run event replay

The API can mount an injected run-event service at `GET /v1/runs/:runId/events`. It requires an authenticated Academy or Command session, a tenant UUID and an explicitly authorized origin. The service verifies project membership before reading the existing append-only workflow outbox.

Clients resume with the standard `Last-Event-ID` header or the `after` query parameter. The bounded response emits durable event IDs in order and finishes with a `replay-end` cursor. A client can reconnect after page refresh without replaying already observed events. Unknown runs and cross-tenant or non-member access share the same not-found response.

The endpoint is disabled unless a trusted runtime injects authentication and durable event storage. This increment does not implement live notification fanout, user cancellation, idempotent retry, provider cancellation guarantees, production deployment or browser acceptance; those remain required before SIE-017 is complete.
