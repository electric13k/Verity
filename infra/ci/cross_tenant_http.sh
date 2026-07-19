#!/usr/bin/env bash
# cross_tenant_http.sh — authenticated-as-wrong-user corpus for the platform
# wiring routes. Boots a throwaway Postgres 16 + brain + TWO gateway instances
# (dev users A and B sharing one brain/DB), then asserts that user B, holding a
# valid session, can NEVER reach user A's tenant-scoped resources. The only
# cross-user read allowed is the PUBLIC transcript route (share id = capability).
#
# Invoked by cross_tenant_test.sh. Repeatable; everything is torn down on exit.
set -euo pipefail
cd "$(dirname "$0")/../.."

PGBIN="/usr/lib/postgresql/16/bin"
PY="$PWD/services/brain/.venv/bin/python"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/verity-xtenant.XXXXXX")"
PGDATA="$WORK/pgdata"; PGPORT=55433; PGHOST="127.0.0.1"
GRPC_ADDR="127.0.0.1:59110"
GWA="127.0.0.1:58090"; GWB="127.0.0.1:58095"
A="http://$GWA"; B="http://$GWB"
DBURL="postgresql://verity@$PGHOST:$PGPORT/verity"
ENC_KEY="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
PGRUN=(); [ "$(id -u)" = "0" ] && PGRUN=(runuser -u postgres --)

BRAIN_PID=""; GWA_PID=""; GWB_PID=""
fail() { echo "XTENANT FAIL: $*" >&2; exit 1; }
cleanup() {
  set +e
  [ -n "$GWA_PID" ] && kill "$GWA_PID" 2>/dev/null
  [ -n "$GWB_PID" ] && kill "$GWB_PID" 2>/dev/null
  [ -n "$BRAIN_PID" ] && kill "$BRAIN_PID" 2>/dev/null
  [ -d "$PGDATA" ] && "${PGRUN[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT
chmod 777 "$WORK"

"${PGRUN[@]}" "$PGBIN/initdb" -D "$PGDATA" -U verity --auth=trust >/dev/null
"${PGRUN[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $WORK -c listen_addresses=$PGHOST" \
  -l "$WORK/pg.log" -w start >/dev/null
"${PGRUN[@]}" "$PGBIN/createdb" -h "$PGHOST" -p "$PGPORT" -U verity verity
for m in 0001_schema_v1 0002_compute_network 0003_platform_wiring; do
  "${PGRUN[@]}" "$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U verity -d verity -v ON_ERROR_STOP=1 \
    -q -f "infra/migrations/${m}.sql" >/dev/null
done

(cd services/gateway && go build -o "$WORK/gateway" .)

env -C services/brain \
  DATABASE_URL="$DBURL" ENCRYPTION_KEY="$ENC_KEY" \
  VERITY_DEV_MODE=1 VERITY_DEFAULT_MODEL="echo:echo" \
  BRAIN_GRPC_ADDR="$GRPC_ADDR" VERITY_OFFICE_STATE_PATH="$WORK/offices" \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 58191 >"$WORK/brain.log" 2>&1 &
BRAIN_PID=$!

env VERITY_DEV_MODE=1 VERITY_DEV_USER_ID="tenant_A" \
  BRAIN_GRPC_ADDR="$GRPC_ADDR" GATEWAY_ADDR="$GWA" "$WORK/gateway" >"$WORK/gwa.log" 2>&1 &
GWA_PID=$!
env VERITY_DEV_MODE=1 VERITY_DEV_USER_ID="tenant_B" \
  BRAIN_GRPC_ADDR="$GRPC_ADDR" GATEWAY_ADDR="$GWB" "$WORK/gateway" >"$WORK/gwb.log" 2>&1 &
GWB_PID=$!

for i in $(seq 1 50); do curl -sf "$A/healthz" >/dev/null 2>&1 && curl -sf "$B/healthz" >/dev/null 2>&1 && break; sleep 0.2; [ "$i" = 50 ] && fail "gateways did not come up"; done
for i in $(seq 1 50); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$A/v1/chat" -H 'content-type: application/json' -d '{"message":"warmup"}')
  [ "$code" != "503" ] && break; sleep 0.2; [ "$i" = 50 ] && fail "brain gRPC not reachable"
done

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
deny() { # a status code that means "no data" (404 not-found is the fail-closed default here)
  case "$1" in 403|404) return 0;; *) return 1;; esac
}

# --- user A creates resources ----------------------------------------------
A_META=$(curl -sN -XPOST "$A/v1/chat" -H 'content-type: application/json' \
  -d '{"message":"tenant A private secret note"}' \
  | awk '/^event: meta$/{getline; sub(/^data: /,""); print; exit}')
A_CONV=$(echo "$A_META" | jq -r .conversation_id)
A_MSG=$(echo "$A_META" | jq -r .message_id)
A_SHARE=$(curl -sf "$A/v1/conversations/$A_CONV" | jq -r .share_id)
A_OFFICE=$(curl -sf -XPOST "$A/v1/offices" -H 'content-type: application/json' \
  -d '{"name":"A-office","brief":"A private brief"}' | jq -r .id)
A_RUN=$(curl -sf -XPOST "$A/v1/offices/$A_OFFICE/run" | jq -r .run_id)
A_MCP=$(curl -sf -XPOST "$A/v1/mcp/servers" -H 'content-type: application/json' \
  -d '{"name":"A-mcp","base_url":"https://mcp.example.com/rpc"}' | jq -r .id)
curl -sf -XPUT "$A/v1/provider-keys/anthropic" -H 'content-type: application/json' \
  -d '{"key":"sk-A-only-secret"}' >/dev/null
[ -n "$A_CONV" ] && [ "$A_CONV" != "null" ] || fail "A setup failed"

# --- user B (valid session) must be denied A's resources -------------------
echo "   B -> A conversation detail"
deny "$(status "$B/v1/conversations/$A_CONV")" || fail "B read A conversation"
echo "   B -> A conversation PATCH"
deny "$(status -XPATCH "$B/v1/conversations/$A_CONV" -H 'content-type: application/json' -d '{"title":"pwned"}')" || fail "B renamed A conversation"
echo "   B -> A conversation DELETE"
deny "$(status -XDELETE "$B/v1/conversations/$A_CONV")" || fail "B deleted A conversation"
# Regenerate/edit are SSE: denial arrives as an `error` event (after the 200
# stream header) with no delta — no A content ever streams. Assert exactly that.
sse_denied() { # stdin = SSE body
  local body; body="$(cat)"
  echo "$body" | grep -q '^event: error' || return 1
  echo "$body" | grep -q '^event: delta' && return 1   # no A content leaked
  return 0
}
echo "   B -> regenerate A message"
curl -sN -XPOST "$B/v1/messages/$A_MSG/regenerate" -H 'content-type: application/json' -d '{}' \
  | sse_denied || fail "B regenerated A message (leaked or streamed)"
echo "   B -> edit A message"
curl -sN -XPATCH "$B/v1/messages/$A_MSG" -H 'content-type: application/json' -d '{"content":"pwned"}' \
  | sse_denied || fail "B edited A message (leaked or streamed)"
echo "   B -> branch from A message"
deny "$(status -XPOST "$B/v1/branches" -H 'content-type: application/json' -d "{\"message_id\":\"$A_MSG\",\"kind\":\"flow\"}")" || fail "B branched A message"
echo "   B -> A office run detail"
deny "$(status "$B/v1/offices/$A_OFFICE/runs/$A_RUN")" || fail "B read A office run"
echo "   B -> run A office"
deny "$(status -XPOST "$B/v1/offices/$A_OFFICE/run")" || fail "B ran A office"
echo "   B -> mcp/call on A server"
deny "$(status -XPOST "$B/v1/mcp/call" -H 'content-type: application/json' -d "{\"server_id\":\"$A_MCP\",\"tool\":\"x\",\"consent\":true}")" || fail "B called A mcp server"

# B's list views must not contain A's rows
echo "   B list views exclude A's rows"
curl -sf "$B/v1/conversations" | jq -e --arg id "$A_CONV" '.items | all(.id != $id)' >/dev/null || fail "A conversation leaked into B list"
curl -sf "$B/v1/offices" | jq -e --arg id "$A_OFFICE" '.items | all(.id != $id)' >/dev/null || fail "A office leaked into B list"
curl -sf "$B/v1/mcp/servers" | jq -e --arg id "$A_MCP" '.items | all(.id != $id)' >/dev/null || fail "A mcp server leaked into B list"
# B's provider-keys / /me must not show A's anthropic key
curl -sf "$B/v1/provider-keys" | jq -e '.providers[] | select(.provider=="anthropic") | .configured == false' >/dev/null || fail "A provider key visible to B"
curl -sf "$B/v1/me" | jq -e '.providers[] | select(.id=="anthropic") | .configured == false' >/dev/null || fail "A key surfaced in B /me"

# The PUBLIC transcript IS readable cross-user (share id is the capability) —
# this is intended; assert it works so the deny checks aren't a false pass.
echo "   public transcript IS shareable by share id"
[ "$(status "$B/v1/transcripts/$A_SHARE")" = "200" ] || fail "public transcript not readable by share id"

echo "gateway wrong-user HTTP corpus: all cross-tenant checks fail closed"
