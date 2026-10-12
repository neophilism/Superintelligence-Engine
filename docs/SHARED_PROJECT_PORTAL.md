# Shared Project Portal — Academy and Command Center

A single engine-owned ProjectPortal React component and ProjectPortalClient supply login, authorized organization selection, project browsing, artifact version inspection, and creation. Both separate web applications import exactly this component from a pinned Superintelligence Engine git submodule rather than duplicating project management code.

## Cross-app identity and transfers

- Host the Academy, Command Center and Engine under distinct HTTPS subdomains of the same registered root site, so secure SameSite=Lax host-only engine cookies work for direct credentialed browser requests.
- Configure Engine ACADEMY_PUBLIC_ORIGIN, COMMAND_PUBLIC_ORIGIN, AUTHORIZED_PRODUCT_ORIGINS and OIDC return/callback URLs. Each frontend receives NEXT_PUBLIC_ENGINE_ORIGIN with the actual engine HTTPS origin and NEXT_PUBLIC_COMPANION_ORIGIN with the other frontend's HTTPS origin.
- The engine validates session/product and tenant project membership on every operation. The portal has no privileged key, makes no provider calls and never invents projects.
- Transfers use only exact canonical tenant/project UUIDs in the destination's URL query; these IDs are **not** authentication tokens. If the destination app must sign in, its pending project reference is held in sessionStorage across the OIDC redirect and reopened only if access remains authorized.
- The user must be provisioned with an actual organization membership. Creating identities, assigning permissions and real OIDC setup remain operational tasks.
- No cross-site cookie workaround, wildcard CORS, secret-in-URL or demo data is permitted. If the engine is not configured, the portal explicitly says storage is unavailable.

## Acceptance checks

Run node --test packages/ui/test/project-portal.test.mjs. Production release also requires a three-host same-site browser E2E test with actual test user accounts, OIDC, tenant membership, artifact revisions and transfer in both directions. An application build alone cannot establish those acceptance gates.
