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
# Prefer the brain's own venv (has pytest); fall back to $PYTHON / python3.
if [ -x services/brain/.venv/bin/python ]; then
  PY="$PWD/services/brain/.venv/bin/python"
else
  PY="${PYTHON:-python3}"
fi
(cd services/brain && "$PY" -m pytest tests/test_tenant.py tests/test_vault.py \
    "tests/test_pipeline.py::test_memory_isolation_between_users" -q)

echo "== core wrong-user corpus (tenant filter mandatory, fail closed)"
# qdrant:: — mandatory tenant payload filter; coordinator:: — compute-network
# surface refuses work without gateway-injected identity (and degrades, never
# dies, when the datastore is absent).
(cd services/core && cargo test --quiet -- qdrant:: coordinator::)

# --- authenticated-as-wrong-user HTTP corpus (platform wiring pass) ---------
# Every tenant-scoped platform route: user B, with a valid session, must never
# reach user A's resources (404/403, never data). Boots a throwaway Postgres 16
# + brain + two gateway instances (dev users A and B sharing one brain/DB).
# Requires postgres 16 binaries + the brain .venv + curl + jq; skipped (loudly)
# where those are absent so the unit corpus above still runs everywhere.
PGBIN="/usr/lib/postgresql/16/bin"
BRAIN_PY="services/brain/.venv/bin/python"
if [ -x "$PGBIN/initdb" ] && [ -x "$BRAIN_PY" ] && command -v curl >/dev/null && command -v jq >/dev/null; then
  echo "== gateway wrong-user HTTP corpus (live two-user stack)"
  bash infra/ci/cross_tenant_http.sh
else
  echo "== SKIP live wrong-user HTTP corpus (postgres/venv/curl/jq not all present)"
fi

echo "cross-tenant: all wrong-user checks passed"
