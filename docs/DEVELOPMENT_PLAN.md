# Superintelligence-Engine — Development plan

**Canonical structured roadmap:** [registry/roadmap.json](../registry/roadmap.json) (40 approved work units). **Detailed full PR specifications:** [docs/PR_SPECIFICATIONS.md](PR_SPECIFICATIONS.md). This is a summary/redirect document only. Retain these documents alongside the structured plan.

## Product architecture

Shared AI service orchestrator with capability/provider adapters, a universal workspace SDK, persistent projects/artifacts, workflow execution, provider cost safety, isolated sandboxes, creative tools and secure deployment operations.

## Implementation record

The source repository owns `registry/roadmap.json`. Planned units cannot be treated as implemented until a real GitHub implementation PR with the exact unit ID is merged and CI passes. Engine Room discovers the source repo, fetches the canonical roadmap and verifies PR merge records from GitHub. No manually maintained Engine Room count is authorized. A merged PR does not by itself certify deployment or runtime functionality.

## Continuation protocol

1. Read roadmap, detailed PR specifications and repository main branch before developing.
2. Choose an unimplemented work unit with all required predecessor units satisfied.
3. Implement code and tests on a feature branch; open an actual PR titled with the exact work unit ID.
4. Await CI, review and security acceptance; merge verified work, then update any real PR mapping in the **source repo** if necessary.
5. Verify actual service health and release SHA before making deployment claims.

## Current scope

The plan covers 40 implementation units. The other two repos own their own plans and must not be copied into this repository. The approved denominator only changes if the user authorizes a new scope revision.
