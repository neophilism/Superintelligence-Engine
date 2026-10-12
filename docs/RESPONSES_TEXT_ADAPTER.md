# SIE-012A — OpenAI Responses text adapter

Implements a transport for the currently documented OpenAI Responses HTTP streaming API using bounded Server-Sent Events parsing.

- Supports text.generate and reason.generate through the existing SIE-011 ProviderAdapters authorization boundary.
- Budget authority and tenant-bound reservation must be checked BEFORE a key or outbound request is released by the registry. No direct UI can bypass the provider registry.
- Requests set store:false, stream:true, no external tools, and a bounded maximum output tokens.
- Emits validated token, usage and complete events. Missing or malformed token usage never counts as a completed generation.
- Credentials must be kept in server-side PROVIDER_OPENAI_API_KEY, never in application code, source maps or browser responses.
- This PR does not initiate paid requests, register a production model, or claim a successful live provider call. Production is disabled until a user-approved provider contract, current regional rights, verified pricing, funded hard cap and integration testing are available.
- Next SIE-012 implementation slice must compose stream with durable authorized project artifacts, actual usage settlement and authenticated run APIs. Do NOT mark SIE-012 production acceptance complete based only on this adapter.

Reference: https://developers.openai.com/api/docs/guides/streaming-responses
