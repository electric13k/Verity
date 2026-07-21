# syntax=docker/dockerfile:1
# Verity brain — private-subnet AI service: FastAPI HTTP probes (/healthz on
# :8000) + a gRPC API (BRAIN_GRPC_ADDR, :9100) started in the app lifespan.
# Reached ONLY through the gateway over the private network; never published.
#
# BUILD CONTEXT = services/brain (self-contained: the generated protobuf stubs
# live committed under app/pb, so no repo-root proto tree is needed here).
#   docker build -f services/brain/Dockerfile -t verity/brain services/brain
# (infra/docker/compose.prod.yaml sets context: ../../services/brain.)

# ---- build ------------------------------------------------------------------
# A throwaway venv is built here and copied wholesale into the runtime stage so
# pip, the build backend (hatchling), and caches never reach the final image.
FROM python:3.12-slim AS build
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /src

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Manifest + sources, then a single project install. hatchling packages the
# `app` module (see pyproject [tool.hatch]) into the venv, and pip pulls the
# runtime deps (fastapi/uvicorn/grpcio/protobuf/cryptography/httpx/pydantic).
# All ship as manylinux wheels for cp312 → no C toolchain needed in this stage.
# cognee stays an OPTIONAL extra (heavy) and is NOT installed: memory degrades
# to the vault/in-process store, per the boot-degrades law.
COPY pyproject.toml ./
COPY app ./app
RUN --mount=type=cache,target=/root/.cache/pip pip install .

# ---- runtime ----------------------------------------------------------------
FROM python:3.12-slim AS runtime
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# curl only for the container HEALTHCHECK (slim ships none); then a non-root
# system user. No build toolchain, no pip, no sources beyond the venv.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 65532 verity \
    && useradd  --system --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin verity

COPY --from=build /opt/venv /opt/venv

# 8000 = FastAPI HTTP (/healthz). 9100 = gRPC. Both bind 0.0.0.0 via prod
# compose env (BRAIN_GRPC_ADDR=0.0.0.0:9100); neither is published.
EXPOSE 8000 9100

# Liveness: /healthz always answers 200 even when degraded (plan law).
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

USER 65532:65532
# uvicorn serves /healthz on :8000; the gRPC server is started inside the app
# lifespan on BRAIN_GRPC_ADDR (set to 0.0.0.0:9100 by prod compose).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
