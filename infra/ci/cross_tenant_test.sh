#!/usr/bin/env bash
# Cross-tenant isolation corpus.
#
# Today this runs the wrong-user unit corpus:
#   - gateway: unconfigured auth fails closed (503); missing/garbage
#     sessions are 401; per-user rate buckets don't bleed across users
#   - brain: tenant ctx comes from gateway metadata only; requests without
#     it abort UNAUTHENTICATED; vault ciphertexts are AAD-bound to their
#     owner and fail to decrypt for any other user
#
# From M3+ (live DB + endpoints) this grows the authenticated-as-wrong-user
# HTTP corpus: every data-bearing endpoint called with user B's valid
# session against user A's resources must 403/404 — never data.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "== gateway wrong-user corpus"
(cd services/gateway && go test -run 'TestAuth|TestLimiter' ./...)

echo "== brain wrong-user corpus"
PY="${PYTHON:-python3}"
(cd services/brain && "$PY" -m pytest tests/test_tenant.py tests/test_vault.py \
    "tests/test_pipeline.py::test_memory_isolation_between_users" -q)

echo "== core wrong-user corpus (tenant filter mandatory, fail closed)"
# qdrant:: — mandatory tenant payload filter; coordinator:: — compute-network
# surface refuses work without gateway-injected identity (and degrades, never
# dies, when the datastore is absent).
(cd services/core && cargo test --quiet -- qdrant:: coordinator::)

echo "cross-tenant: all wrong-user checks passed"
