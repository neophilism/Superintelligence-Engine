# SIE-009 Domain tool manifest and signed registry

The engine loads **only locally trusted implementation modules** after checking an Ed25519 publisher signature on canonical manifest JSON, engine-version compatibility, exact domain/anchor IDs, valid JSON schemas and approved tool scopes. A signature alone never authorizes executing arbitrary remote code. Help slots are stable `domain.control-id` identifiers consumed only by Academy. The Command Center uses the identical UI controls without tutoring.

Package `@superintelligence/toolkit` contains a safe local sample handler for line-counting and test fixtures for invalid signatures, untrusted modules and capability scoping. No third-party dynamic code, model-generated tool authority or raw network module loading is permitted. Future tools must include origin policy, installation review and explicit user grant controls.
