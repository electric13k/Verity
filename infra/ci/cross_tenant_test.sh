#!/usr/bin/env bash
# Cross-tenant isolation test harness.
#
# From M2 onward this script runs the authenticated-as-wrong-user corpus:
# every data-bearing endpoint is called with a valid session for user B
# against resources owned by user A, and MUST return 403/404 — never data.
# A forgotten tenant filter fails closed (gateway-injected tenant_ctx), and
# this suite is the CI proof.
set -euo pipefail

echo "cross-tenant: no tenant-scoped surface exists yet (lands in M2)."
echo "cross-tenant: this job is wired now so the gate cannot be forgotten later."
exit 0
