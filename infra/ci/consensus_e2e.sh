#!/usr/bin/env bash
# Live 2-node consensus E2E for the scattered-compute network (M7).
#
# Proves the whole loop against real Postgres and two real daemon processes:
#   submit job (user-facing, gateway → coordinator)
#     → 2 work-unit assignments to 2 DISTINCT-owner daemons (sybil-pair guard)
#       → both results in → consensus verified → credits granted to both nodes.
#
# Self-contained and repeatable: it stands up a throwaway Postgres 16 cluster,
# applies migrations 0001 + 0002 by named command (migration law), runs core +
# gateway + two node daemons, submits a job through the gateway, and asserts
# the terminal state in the database.
#
# Docker is not required. No secrets are used or printed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# The Postgres server runs as the unprivileged 'postgres' user, which must be
# able to traverse every parent of its data dir. /tmp (world-traversable) is
# used rather than an agent scratchpad whose parents may be root-only.
RUN="${PGRUN:-/tmp/verity-pg-e2e}"
PGDATA="$RUN/data"
PGSOCK="$RUN/sock"
LOGS="$RUN/logs"
PGBIN="/usr/lib/postgresql/16/bin"
PGPORT="${PGPORT:-55432}"
PGUSER="postgres"
DBNAME="verity"
DBURL="postgres://postgres@127.0.0.1:${PGPORT}/${DBNAME}"

CORE_GRPC="127.0.0.1:19200"
CORE_HTTP="127.0.0.1:18200"
GW_ADDR="127.0.0.1:18080"
NODEA_HTTP="127.0.0.1:18301"
NODEB_HTTP="127.0.0.1:18302"

PIDS=()
cleanup() {
  set +e
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null; done
  if [ -d "$PGDATA" ]; then
    runuser -u "$PGUSER" -- "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  fi
}
trap cleanup EXIT

psql_super() { runuser -u "$PGUSER" -- psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$@"; }
q() { psql_super -tAc "$1" "$DBNAME"; }

wait_for_http() { # url, name
  for _ in $(seq 1 50); do
    if curl -fsS "$1" >/dev/null 2>&1; then return 0; fi
    sleep 0.3
  done
  echo "FAIL: $2 did not come up ($1)"; exit 1
}

echo "== [1/8] fresh Postgres cluster"
rm -rf "$RUN"; mkdir -p "$PGDATA" "$PGSOCK" "$LOGS"
chown -R "$PGUSER" "$RUN"
runuser -u "$PGUSER" -- "$PGBIN/initdb" -D "$PGDATA" --auth-local=trust --auth-host=trust >/dev/null
runuser -u "$PGUSER" -- "$PGBIN/pg_ctl" -D "$PGDATA" \
  -o "-p $PGPORT -k $PGSOCK -c listen_addresses=127.0.0.1" \
  -l "$LOGS/pg.log" -w start
runuser -u "$PGUSER" -- "$PGBIN/createdb" -h 127.0.0.1 -p "$PGPORT" "$DBNAME"

echo "== [2/8] apply migrations 0001 + 0002 (named command)"
# Migration law: numbered SQL files, applied by explicit named command.
psql_super "$DBNAME" < "$ROOT/infra/migrations/0001_schema_v1.sql" >/dev/null
psql_super "$DBNAME" < "$ROOT/infra/migrations/0002_compute_network.sql" >/dev/null
echo "   applied: $(q "select count(*) from information_schema.tables where table_name in ('compute_nodes','compute_jobs','work_units','assignments','credit_entries')")/5 compute tables present"

echo "== [3/8] build core + node daemon"
( cd "$ROOT/services/core" && PATH="/usr/bin:$PATH" cargo build -q )
( cd "$ROOT/services/node" && PATH="/usr/bin:$PATH" cargo build -q )
CORE_BIN="$ROOT/services/core/target/debug/verity-core"
NODE_BIN="$ROOT/services/node/target/debug/verity-node"

echo "== [4/8] start core (coordinator) + gateway"
DATABASE_URL="$DBURL" CORE_GRPC_ADDR="$CORE_GRPC" CORE_HTTP_ADDR="$CORE_HTTP" \
  "$CORE_BIN" >"$LOGS/core.log" 2>&1 &
PIDS+=($!)
wait_for_http "http://$CORE_HTTP/healthz" "core"

# Gateway in dev-auth mode: the job submitter authenticates as 'submitter';
# the gateway injects tenant ctx into gRPC metadata (never a request body).
VERITY_DEV_MODE=1 VERITY_DEV_USER_ID="submitter" \
  CORE_GRPC_ADDR="$CORE_GRPC" GATEWAY_ADDR="$GW_ADDR" \
  "$ROOT/services/gateway/gateway" >"$LOGS/gateway.log" 2>&1 &
PIDS+=($!)
wait_for_http "http://$GW_ADDR/healthz" "gateway"

echo "== [5/8] start two daemons with DIFFERENT owners (alice, bob)"
VERITY_OWNER_ID="alice" NODE_NAME="nodeA" COORDINATOR_GRPC_ADDR="http://$CORE_GRPC" \
  NODE_HTTP_ADDR="$NODEA_HTTP" NODE_POLL_MS=300 \
  "$NODE_BIN" >"$LOGS/nodeA.log" 2>&1 &
PIDS+=($!)
VERITY_OWNER_ID="bob" NODE_NAME="nodeB" COORDINATOR_GRPC_ADDR="http://$CORE_GRPC" \
  NODE_HTTP_ADDR="$NODEB_HTTP" NODE_POLL_MS=300 \
  "$NODE_BIN" >"$LOGS/nodeB.log" 2>&1 &
PIDS+=($!)
wait_for_http "http://$NODEA_HTTP/healthz" "nodeA"
wait_for_http "http://$NODEB_HTTP/healthz" "nodeB"
# Let both daemons register before we submit.
for _ in $(seq 1 30); do
  [ "$(q "select count(*) from compute_nodes")" = "2" ] && break; sleep 0.3
done
echo "   registered nodes: $(q "select count(*) from compute_nodes") (owners: $(q "select string_agg(owner_id, ',' order by owner_id) from compute_nodes"))"

echo "== [6/8] submit job through the gateway (user-facing)"
RESP="$(curl -fsS -X POST "http://$GW_ADDR/v1/compute/jobs" \
  -H 'content-type: application/json' \
  -d '{"model":"verity-9b","prompt":"What is the capital of France?"}')"
echo "   gateway response: $RESP"
WU_ID="$(printf '%s' "$RESP" | sed -n 's/.*"work_unit_id":"\([^"]*\)".*/\1/p')"
[ -n "$WU_ID" ] || { echo "FAIL: no work_unit_id in response"; exit 1; }

echo "== [7/8] wait for consensus"
STATUS=""
for _ in $(seq 1 40); do
  STATUS="$(q "select status from work_units where id='$WU_ID'")"
  [ "$STATUS" = "verified" ] && break
  [ "$STATUS" = "conflicted" ] && break
  sleep 0.3
done
echo "   work_unit status: $STATUS"

echo "== [8/8] assertions"
FAIL=0
assert() { # description, actual, expected
  if [ "$2" = "$3" ]; then echo "   PASS: $1 ($2)"; else echo "   FAIL: $1 — got '$2', want '$3'"; FAIL=1; fi
}
assert "work unit verified"            "$STATUS" "verified"
assert "exactly 2 assignments"         "$(q "select count(*) from assignments where work_unit_id='$WU_ID'")" "2"
assert "assignments span 2 owners"     "$(q "select count(distinct n.owner_id) from assignments a join compute_nodes n on n.id=a.node_id where a.work_unit_id='$WU_ID'")" "2"
assert "2 credit entries written"      "$(q "select count(*) from credit_entries where work_unit_id='$WU_ID'")" "2"
assert "both credits are +10"          "$(q "select count(*) from credit_entries where work_unit_id='$WU_ID' and delta=10 and reason='verified_unit'")" "2"
assert "alice node credited 10"        "$(q "select coalesce(sum(ce.delta),0) from credit_entries ce join compute_nodes n on n.id=ce.node_id where n.owner_id='alice'")" "10"
assert "bob node credited 10"          "$(q "select coalesce(sum(ce.delta),0) from credit_entries ce join compute_nodes n on n.id=ce.node_id where n.owner_id='bob'")" "10"
assert "job marked done"               "$(q "select status from compute_jobs order by created_at desc limit 1")" "done"

echo
if [ "$FAIL" = "0" ]; then
  echo "consensus E2E: ALL CHECKS PASSED"
else
  echo "consensus E2E: FAILURES ABOVE"; echo "--- nodeA.log tail ---"; tail -5 "$LOGS/nodeA.log";
  echo "--- nodeB.log tail ---"; tail -5 "$LOGS/nodeB.log"; echo "--- core.log tail ---"; tail -10 "$LOGS/core.log";
  exit 1
fi
