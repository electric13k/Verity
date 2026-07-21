# Verity gateway — the only public service (plan §1). Multi-stage, non-root,
# minimal: a CGO-free static Go binary on distroless/static.
#
# BUILD CONTEXT = REPO ROOT. The gateway's go.mod carries a local replace:
#   replace github.com/electric13k/verity/packages/proto/gen/go => ../../packages/proto/gen/go
# so the build needs both services/gateway AND packages/proto/gen/go in scope.
# Build it as:
#   docker build -f services/gateway/Dockerfile -t verity/gateway .
# (infra/docker/compose.prod.yaml sets context: ../.. accordingly.)

# ---- build ------------------------------------------------------------------
FROM golang:1.25-alpine AS build
WORKDIR /src

# The local replace target must exist before `go mod download` / build.
COPY packages/proto/gen/go ./packages/proto/gen/go

# Module graph first for layer caching (deps rarely change).
COPY services/gateway/go.mod services/gateway/go.sum ./services/gateway/
WORKDIR /src/services/gateway
RUN go mod download

# Then the sources. Only the gateway package is compiled (`go build .`);
# _test.go files and any stray local ./gateway binary are ignored.
COPY services/gateway/ ./
# CGO off => a fully static binary that runs on distroless/static (no libc).
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/gateway .

# ---- runtime ----------------------------------------------------------------
# distroless/static:nonroot — no shell, no package manager, runs as uid 65532.
FROM gcr.io/distroless/static-debian12:nonroot

# A single static busybox purely for the container HEALTHCHECK (distroless has
# no shell/curl). It is never invoked by the app.
COPY --from=busybox:musl /bin/busybox /busybox
COPY --from=build /out/gateway /gateway

# 8080 = HTTP/SSE/WS. In prod GATEWAY_ADDR is set to 0.0.0.0:8080 (compose).
EXPOSE 8080

# Liveness: /healthz always answers 200 (degraded is still "up", plan law).
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD ["/busybox", "wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]

USER nonroot:nonroot
ENTRYPOINT ["/gateway"]
