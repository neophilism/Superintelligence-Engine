# SIE-017 run event replay

The API can mount an injected run-event service at `GET /v1/runs/:runId/events`. It requires an authenticated Academy or Command session, a tenant UUID and an explicitly authorized origin. The service verifies project membership before reading the existing append-only workflow outbox.

Clients resume with the standard `Last-Event-ID` header or the `after` query parameter. The bounded response emits durable event IDs in order and finishes with a `replay-end` cursor. A client can reconnect after page refresh without replaying already observed events. `EngineClient.replayRunEvents` validates the run, tenant, product and cursor, sends the bounded replay request with credentials, and rejects malformed or incomplete SSE before returning `{events, cursor}`. Unknown runs and cross-tenant or non-member access share the same not-found response.

The endpoint is disabled unless a trusted runtime injects authentication and durable event storage. The SDK helper consumes a bounded response; it does not hold a live connection open or silently retry. Callers persist the returned cursor and explicitly request the next replay after reconnecting.

The bounded replay endpoint alone does not implement live notification fanout, provider cancellation guarantees, production deployment or browser acceptance; those remain required before SIE-017 is complete.

## Cancellation and retry controls

A trusted runtime may inject the same authenticated queue service for `POST /v1/runs/:runId/cancel` and `POST /v1/runs/:runId/retry`. Both routes require an Academy or Command session, tenant UUID and explicitly authorized origin. Retry accepts a bounded JSON body containing `idempotencyKey`; the service enforces its safe-key format and durable replay semantics.

The HTTP boundary preserves service error semantics. In particular, provider-linked or ambiguous work returns `provider_cancel_unavailable` or `retry_unsafe`; the route never reports a provider cancellation that did not occur. The boundary stays disabled unless both authentication and the durable service are injected.
