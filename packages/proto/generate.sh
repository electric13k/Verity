#!/usr/bin/env bash
# Regenerates gRPC stubs from the .proto contracts.
#
# Requirements: protoc, protoc-gen-go, protoc-gen-go-grpc on PATH, and a
# Python with grpcio-tools (set PYTHON to point at it).
#
# Go and Python stubs are committed (no protoc needed to build those
# services). Rust stubs are generated at build time by services/core/build.rs
# (tonic-build), which needs protoc on PATH.
set -euo pipefail
cd "$(dirname "$0")"
PYTHON="${PYTHON:-python3}"

# --- Go → gen/go (own module, consumed by gateway via replace directive)
mkdir -p gen/go
protoc -I . \
  --go_out="module=github.com/electric13k/verity/packages/proto/gen/go:gen/go" \
  --go-grpc_out="module=github.com/electric13k/verity/packages/proto/gen/go:gen/go" \
  verity/v1/*.proto

# --- Python → services/brain/app/pb (brain adds this dir to sys.path)
PB_OUT=../../services/brain/app/pb
mkdir -p "$PB_OUT"
"$PYTHON" -m grpc_tools.protoc -I . \
  --python_out="$PB_OUT" \
  --grpc_python_out="$PB_OUT" \
  verity/v1/*.proto
touch "$PB_OUT/__init__.py" "$PB_OUT/verity/__init__.py" "$PB_OUT/verity/v1/__init__.py"

echo "generated: go → gen/go, python → services/brain/app/pb"
