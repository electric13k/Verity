# syntax=docker/dockerfile:1
# Verity compute node daemon (M7) — a volunteer worker. axum HTTP probe
# (/healthz on :8300) + a tonic gRPC CLIENT that dials the coordinator
# (COORDINATOR_GRPC_ADDR, needs an http:// scheme). It runs no gRPC server and
# publishes no ports; in prod it is an OPTIONAL, off-by-default service.
#
# BUILD CONTEXT = REPO ROOT. build.rs (tonic-build) compiles the coordinator
# client stubs from ../../packages/proto, so BOTH services/node AND
# packages/proto must be in scope, and protoc must be on PATH in the build stage.
#   docker build -f services/node/Dockerfile -t verity/node .
# (infra/docker/compose.prod.yaml sets context: ../.. accordingly.)

# ---- build ------------------------------------------------------------------
FROM rust:1-slim-bookworm AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src

COPY packages/proto ./packages/proto

# Dependency pre-build for cargo caching (stub main → compile deps + codegen).
COPY services/node/Cargo.toml services/node/Cargo.lock ./services/node/
COPY services/node/build.rs ./services/node/
RUN mkdir -p services/node/src && echo 'fn main() {}' > services/node/src/main.rs
WORKDIR /src/services/node
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --locked

COPY services/node/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    touch src/main.rs && cargo build --release --locked \
    && mkdir -p /out && cp target/release/verity-node /out/verity-node

# ---- runtime ----------------------------------------------------------------
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=busybox:musl /bin/busybox /busybox
COPY --from=build /out/verity-node /verity-node

# 8300 = HTTP /healthz (NODE_HTTP_ADDR). No gRPC server (pure client); no
# published ports. Binds 0.0.0.0 via prod compose env.
EXPOSE 8300

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD ["/busybox", "wget", "-q", "--spider", "http://127.0.0.1:8300/healthz"]

USER nonroot:nonroot
ENTRYPOINT ["/verity-node"]
