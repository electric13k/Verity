# @verity/proto

Single source of truth for the gRPC contracts between gateway (Go), brain (Python), and core (Rust).

- `verity/v1/common.proto` — `TenantCtx`, health messages
- `verity/v1/brain.proto` — `BrainService` (hello-path, chat streaming)
- `verity/v1/core.proto` — `CoreService` (echo, tenant-filtered vector search)

## Rules

1. Tenant identity travels ONLY in gRPC metadata (`x-verity-user-id`, `x-verity-org-id`, `x-verity-request-id`), injected by the gateway after session verification. Services must never trust tenant fields in request bodies.
2. Breaking changes require a new package version (`verity.v2`), never in-place edits to released messages.
3. Generated code lives under `gen/` (git-ignored) and is produced by `buf generate` or each service's build (`tonic-build` for Rust, `grpcio-tools` for Python, `protoc-gen-go` for Go). Codegen wiring lands in M1.
