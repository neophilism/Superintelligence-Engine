# SIE-016 durable workflow execution

A real PostgreSQL queue and transactional outbox for source-controlled workflow plans. Deployment and provider calls remain disabled until a user-approved service, authorized connector and spend limits are configured.

## Safety and retry contract

- A recipe is validated before enqueue. The authenticated caller must have a real write membership on the project. Idempotency key replays are accepted only for the same user/project/recipe.
- Read-only, **zero-spend** nodes can become ready. Every generation, external-action or positive-cost node is stored as blocked_policy until later provider authorization work. A blank project cannot trigger paid calls.
- Workers atomically lease jobs via FOR UPDATE SKIP LOCKED. Checkpoints require a live matching lease.
- Before an external provider call, a future authorized dispatcher must persist a stable provider_dispatch_key and markDispatchStarted. If the worker crashes afterward, the lease expires into needs_reconciliation and must be checked against provider receipts before any retry. Automatically repeating a billable call is forbidden.
- Completing a job unlocks only its satisfied dependencies in the same database transaction. Outbox events are committed alongside job state; notification workers claim and acknowledge separately.
- Authenticated cancellation atomically stops only local, non-dispatched work, revokes active leases and records `run.cancelled`. Any provider task ID, dispatched job or reconciliation state fails closed with `provider_cancel_unavailable`; this service does not claim a provider was cancelled.
- Manual retry accepts a caller idempotency key, resets only zero-cost read jobs that are failed or safely cancelled, preserves succeeded dependencies and records durable retry events. Billable or provider-linked work fails closed pending explicit reconciliation.
- Queue tables have FORCE RLS with no public grants or client policies. The queue service uses a dedicated trusted PostgreSQL role and server-side credentials only. Injected same-origin API routes authenticate product sessions and call the same tenant/member-authorized inspection, cancellation and retry methods; they remain unconfigured by default.
- The worker process starts only with WORKER_OPS_ENABLED=1 and WORKER_DATABASE_URL. It has no approved paid handlers in this version.

## Testing

GitHub Actions PostgreSQL integration job applies migration 008 then runs db/test/*.test.mjs: simultaneous worker claims, idempotency collisions, dependent execution, outbox claims, membership denial, lease expiry, and post-dispatch reconciliation. No external AI calls and no paid infrastructure are required by tests.

## Future work

SIE-012: approved provider dispatch and settlement; SIE-017: signed authenticated run APIs, progress/cancel/retry and reconciliation dashboard; SIE-018: asynchronous media jobs with provider-specific idempotency and receipts.