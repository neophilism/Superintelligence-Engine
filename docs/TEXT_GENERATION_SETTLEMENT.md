# SIE-012B: reserved text generation and project artifacts

This component connects an already authorized provider stream to a versioned project artifact and the SIE-014 budget ledger. It makes no live requests by default and exposes no public HTTP route.

## Mandatory safeguards

- Construction defaults to dispatchEnabled=false. Paid execution remains disabled unless a trusted server enables it after authorization, configures a provider registry, verifies the input/output microcredit tariff, and provides a funded, tenant-scoped reservation.
- Every request verifies project write membership, a trusted session identity, a provider identifier, and upper-bound reservation cost BEFORE attempting provider execution.
- A persistent row in text_generation_dispatches is unique to a single tenant/reservation. Concurrent requests serialize on the reserved budget row. Requests with uncertain outcomes are NEVER automatically repeated, so a crash cannot silently duplicate a billable provider call.
- Provider usage and terminal response receipts are required. Actual charges use the SIE-014 atomic ledger. The exact output and provider provenance are stored in immutable project artifacts; raw prompts do not enter the dispatch table.
- A stream/persistence/settlement failure is marked needs_reconciliation. The budget reservation remains held until an operator validates the provider receipt; a blind refund or retry is forbidden.
- A successful replay returns the persisted artifact reference without another provider request.
- Model licensing, provider availability, input-unit maximum and server-side pricing require verification for the actual provider before production activation.

## Tests

The PostgreSQL CI suite tests one-time charges, immutable artifact content, project membership, zero-enabled defaults, over-ceiling rejection, missing provider completion and no-double-dispatch behavior using an in-memory fake provider. No secrets or billable external API calls are necessary.

## Authenticated streaming HTTP boundary

The API can mount an injected text-generation service at `POST /v1/projects/:projectId/text-generations`. The route requires a valid Academy or Command session, tenant identifier and an explicitly authorized same-origin request before parsing or dispatching. It emits bounded Server-Sent Events named `token`, `result` and `error`; internal provider/database messages are never returned. Client disconnect aborts the request signal, but the durable service remains authoritative about whether an uncertain paid call may be retried.

The production server does not construct or enable the service by default. A trusted bootstrap must separately provide authentication, allowed origins, the PostgreSQL-backed service, verified pricing, provider registry and credentials.

## Remaining SIE-012 work

Client reconnect/replay, real provider credentials, actual production tariff validation, a consented live response receipt, operational deployment and response quality remain unfinished. The current roadmap should not represent SIE-012 as accepted or production-ready until all those gates have passed.
