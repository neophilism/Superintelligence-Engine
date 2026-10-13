# SIE-017 run replay and controls

The API can mount injected run services at `GET /v1/runs/:runId/events`, `GET /v1/runs/:runId`, `POST /v1/runs/:runId/cancel` and `POST /v1/runs/:runId/retry`. They require an authenticated Academy or Command session, a tenant UUID and an explicitly authorized origin. The durable service verifies project membership before reading or changing a run.

Clients resume event history with the standard `Last-Event-ID` header or the `after` query parameter. Ordinary requests return a bounded replay immediately. `follow=1` keeps the authenticated SSE response open for a bounded server window, polls the same durable outbox, emits keep-alive comments while idle, and closes after a terminal run event or the deadline. Reconnecting with the last event ID preserves cursor continuity across page refresh and process boundaries.

`EngineClient.replayRunEvents` validates scope and SSE framing for immediate history. `EngineClient.followRunEvents` opts into the bounded live window without adding hidden reconnection or retry behavior; callers persist the returned cursor and reconnect explicitly. `inspectRun`, `cancelRun` and `retryRun` expose credentialed controls without automatic retries.

Cancellation stops only local, non-dispatched work. Provider-linked, dispatched or reconciliation work returns `provider_cancel_unavailable`; the API never claims that an external provider stopped. Retry requires a caller idempotency key and remains limited to the zero-cost read jobs accepted by the durable service. Billable or provider-linked work fails closed.

All routes are disabled unless a trusted runtime injects authentication and durable storage. The live stream is deliberately bounded so abandoned clients cannot hold server resources indefinitely. This increment does not provide provider-native cancellation, production deployment or real-browser acceptance evidence; those remain required before SIE-017 is complete.
