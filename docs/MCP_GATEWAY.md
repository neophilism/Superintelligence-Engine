# SIE-019: Scoped MCP gateway (protocol 2026-07-28)

Implements a real **stateless MCP Streamable HTTP POST client** for allowlisted read-only tools and exact resource URIs. This revision does not use the obsolete initialize/session handshake or a GET SSE channel.

## Fail-closed boundaries

- Endpoint URLs and operation schemas are administrator-installed, never synthesized by model output. Only explicitly allowlisted HTTPS hostnames are accepted. Redirects are forbidden.
- A separately implemented production network-egress guard/firewall is REQUIRED: the gateway refuses to execute without an injected egressGuard. This prevents assuming a DNS lookup is sufficient protection against rebinding/SSRF.
- Each request verifies an unexpired, revocable, tenant-and-user-bound consent grant. No grant means no outbound MCP request. A user-approved grant cannot authorize another tool.
- External-effect tools are intentionally blocked until per-action approval exists; this version provides read tools and exact read-only resources.
- Tool inputs are bounded and checked against a restrictive schema. Results are returned in an explicitly untrusted data envelope, not executed as instructions. MCP bearer credentials are referenced by server-side MCP_* environment keys; the browser never receives them.
- Only SHA-256 digests and decisions are stored in the PostgreSQL audit chain, not source prompts, tokens, or returned documents. The chain is tamper-evident, not proof against a fully compromised privileged DBA.
- SSE is supported when scoped to the POST request. Per-call model elicitation / streaming subscriptions and older MCP protocols are not supported by this initial gateway; additional adapter work must negotiate version deliberately.

## Deployment gating

The DB tables use FORCE RLS and no public grants. Backend service principals must have explicit trusted privileges. No public grant-issuing API exists yet: a higher-trust authenticated consent controller must enforce the actual user gesture before calling grant(...approvedByUser:true). Configuration alone never creates a grant.

Provider integration and end-to-end browser consent acceptance remain distinct release prerequisites. This module is not a license to permit unrestricted model-selected external actions.

## Tests

Run npm test and PostgreSQL CI, including injected malicious tool-response text, attempts at forbidden tool calls, expired/revoked scope checks, outbound egress denial, JSON-RPC request headers and SSE parsing.

Protocol reference: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
