# syntax=docker/dockerfile:1
# Verity core — private-subnet Rust service: axum HTTP probes (/healthz on
# :8200) + tonic gRPC (:9200) for vector search (Qdrant), consensus verify, and
# the compute coordinator. Reached only over the private network; never published.
#
# BUILD CONTEXT = REPO ROOT. build.rs (tonic-build) compiles the shared
# contracts from ../../packages/proto, so BOTH services/core AND packages/proto
# must be in scope, and protoc must be on PATH in the build stage.
#   docker build -f services/core/Dockerfile -t verity/core .
# (infra/docker/compose.prod.yaml sets context: ../.. accordingly.)

# ---- build ------------------------------------------------------------------
FROM rust:1-slim-bookworm AS build
# protoc for tonic-build. No OpenSSL dev headers needed: reqwest/sqlx use
# rustls-tls (see Cargo.toml), so the build is libssl-free.
RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src

# Shared proto contracts first (build.rs input; change rarely) → cache layer.
COPY packages/proto ./packages/proto

# Dependency pre-build for cargo caching: manifests + build.rs + a stub main so
# the (slow) dependency + proto-codegen compile happens before real sources land.
COPY services/core/Cargo.toml services/core/Cargo.lock ./services/core/
COPY services/core/build.rs ./services/core/
RUN mkdir -p services/core/src && echo 'fn main() {}' > services/core/src/main.rs
WORKDIR /src/services/core
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --locked

# Real sources, then the actual build. `touch` forces cargo to recompile the
# crate over the cached stub while reusing the compiled dependency graph.
COPY services/core/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    touch src/main.rs && cargo build --release --locked \
    && mkdir -p /out && cp target/release/verity-core /out/verity-core

# ---- runtime ----------------------------------------------------------------
# distroless/cc — glibc + libgcc for the dynamically-linked Rust binary, no
# shell/pkg-manager, runs as uid 65532 (nonroot). Same bookworm/glibc as the
# build image, so the binary is ABI-compatible.
FROM gcr.io/distroless/cc-debian12:nonroot
# A static musl busybox purely for the HEALTHCHECK (distroless has no shell/wget).
# Never invoked by the app.
COPY --from=busybox:musl /bin/busybox /busybox
COPY --from=build /out/verity-core /verity-core

# 8200 = HTTP /healthz (CORE_HTTP_ADDR). 9200 = gRPC (CORE_GRPC_ADDR). Both bind
# 0.0.0.0 via prod compose env; neither is published (private network only).
EXPOSE 8200 9200

# Liveness: /healthz always answers 200 even when degraded (plan law).
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD ["/busybox", "wget", "-q", "--spider", "http://127.0.0.1:8200/healthz"]

USER nonroot:nonroot
ENTRYPOINT ["/verity-core"]
