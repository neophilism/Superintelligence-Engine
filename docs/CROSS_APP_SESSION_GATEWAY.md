# SIE-003B: cross-product authenticated engine access

This PR makes the existing OIDC product sessions and project APIs usable by two separately deployed applications when they are configured as distinct HTTPS origins under a common same-site parent domain.

## Model

- The engine is the authoritative OIDC callback and uses Secure, HttpOnly, SameSite=Lax, __Host- cookies scoped to the engine host.
- Each frontend sends credentialed fetch requests directly to the explicitly configured engine origin. Requests contain X-SIE-Product and optionally X-Tenant-Id, but the backend still verifies the signed session and project membership.
- The engine handles narrow CORS and OPTIONS requests only for exactly matching ACADEMY_PUBLIC_ORIGIN and COMMAND_PUBLIC_ORIGIN. A command origin cannot request Academy session data by merely setting an Academy product header.
- GET /v1/tenants returns ONLY the currently authenticated user's joined tenant IDs/names/roles. This removes the need for a hardcoded tenant ID in either app. Tenant enumeration is not an invitation or membership mutation route.
- Project POST routes already enforce authorized Origin via AUTHORIZED_PRODUCT_ORIGINS. Production MUST configure that variable to the same exact Academy/Command origins. Never use a wildcard.
- Development on different eTLD+1 hosts, or apps served from unrelated hosting domains, cannot rely on SameSite=Lax cookies for cross-origin credentialed API access. Deploy all three hosts under one registered site OR build a separate audited BFF token exchange. Do not turn on SameSite=None as an unreviewed workaround.
- These changes DO NOT create or provision an OIDC issuer, live database, user membership, secure custom domains or browser acceptance tests. Those must be verified in the real deployment.

## Reproducible tests

Use node --test apps/api/test/product-cors.test.mjs. The tests probe allowed and disallowed origin/product pairs, credentialed membership response, strict OPTIONS allowed headers, unauthenticated sessions, and missing server configuration.

No provider credentials or paid API calls are required.
