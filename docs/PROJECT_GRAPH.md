# SIE-007 canonical projects and immutable artifact revision graph

Authenticated projects and structured artifacts persist in tenant-isolated PostgreSQL. Each artifact has an immutable JSON or verified clean binary-asset backed revision; modifications append a version rather than overwriting history. Explicit `expectedRevision` is required to reject conflicts. A restore creates a **new** revision preserving provenance and earlier drafts. Rights and provenance fields are preserved through editable export manifest, which includes binary file references but not the binary payload (full portable binary packaging is SIE-035). Protected read/write endpoints require valid product-scoped SSO cookie, verified membership and same-origin write request. Without configured databases and identity-provider secrets, the API returns an honest unavailable status. Tests cover create/revise/conflict/restore/export with a real disposable PostgreSQL backend. A production authenticated browser end-to-end test remains a deployment gate.

## Conflict-safe project metadata

Authenticated members can update a project title or workspace kind through
`PATCH /v1/projects/{projectId}` with the current `expectedRevision`. The
service locks the tenant-scoped row and returns `revision_conflict` rather than
overwriting a concurrent edit. The same project revision covers metadata and
artifact membership changes; clients must refresh after a conflict. Tenant RLS,
membership checks, authorized product origins, and browser sessions remain
mandatory. This API contract does not claim the downstream Command Center
editor or live cross-application acceptance is complete.
