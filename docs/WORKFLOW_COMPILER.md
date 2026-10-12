# SIE-015 Typed multi-AI workflow compiler

This package validates and compiles goal-based plans **without executing any model calls**. Goal blueprints cover legislative packages, film pitches and music releases. Dependencies are explicit, inputs require exact artifact MIME compatibility, and consequential external actions are refused unless human approval is required.

## Usage

Run from repository root:

    node scripts/preview-workflow.mjs legislative-package bill summary
    node scripts/preview-workflow.mjs film-pitch pitch-deck trailer
    node scripts/preview-workflow.mjs music-release song cover

The output is a plan preview, *not* generated content. A cost ceiling is not a price estimate: nodes without verified provider pricing are listed as unpriced. The compiler does not contain any provider credentials or execution logic; SIE-016 will add durable execution and SIE-014 provides the spend enforcement boundary.

## Recipe v1

Recipe: schemaVersion=1, id, version, budgetMicros, nodes[], deliverables[].
Node: id, operation, effects (read/generation/external), maxCostMicros, dependsOn[], inputs{}, outputs{}, optional approvalRequired, optional condition.
Input binding: { from: { node, port }, mimeType } or { literal, mimeType }.
Artifact port map: a name-to-MIME-type object. Deliverable: { id, from: {node,port}, mimeType }.

No user-supplied code or expressions are executed by the compiler. Effects and approvals must be validated again immediately before real dispatch. Compilation cannot substitute for API authentication, permission grants, provider availability or live pricing.