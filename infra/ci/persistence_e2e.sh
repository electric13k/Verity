#!/usr/bin/env bash
# persistence_e2e.sh — live end-to-end for the persistence + platform wiring
# pass (P1-P8). Spins up a throwaway native Postgres 16 cluster, applies
# migrations 0001-0003, boots the brain (gRPC) + gateway (HTTP) in dev mode
# (echo provider, no external keys), and drives the real HTTP surface:
#
#   chat persists + meta event + history windowing + auto-name
#   regenerate + edit (SSE, truncation)
#   provider-key PUT -> vaulted (ciphertext in DB, /me + /provider-keys reflect)
#   office create + run + STATE checkpoint
#   upload -> markitdown -> markdown_bytes; referenced from chat
#   branch (flow) -> run_id + branches/flow_runs rows
#   public transcript fetch by share id (NO auth)
#
# Repeatable: everything lives in a mktemp dir, torn down on exit. Requires
# postgres 16 (initdb/pg_ctl), the brain .venv, a built gateway, curl, jq.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"

PGBIN="/usr/lib/postgresql/16/bin"
PY="$ROOT/services/brain/.venv/bin/python"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/verity-e2e.XXXXXX")"
PGDATA="$WORK/pgdata"
PGPORT=55432
PGHOST="127.0.0.1"
GRPC_ADDR="127.0.0.1:59100"
GW_ADDR="127.0.0.1:58080"
BASE="http://$GW_ADDR"
DBURL="postgresql://verity@$PGHOST:$PGPORT/verity"
ENC_KEY="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"  # 32 bytes = 64 hex

# initdb/postgres refuse to run as root; if we are root, drive the cluster as
# the system `postgres` user (present on the debian postgres package). Services
# and psql still connect over TCP with trust auth.
PGRUN=(); [ "$(id -u)" = "0" ] && PGRUN=(runuser -u postgres --)

BRAIN_PID=""; GW_PID=""
fail() { echo "E2E FAIL: $*" >&2; exit 1; }

cleanup() {
  set +e
  [ -n "$GW_PID" ] && kill "$GW_PID" 2>/dev/null
  [ -n "$BRAIN_PID" ] && kill "$BRAIN_PID" 2>/dev/null
  [ -d "$PGDATA" ] && "${PGRUN[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== work dir: $WORK"
chmod 777 "$WORK"  # postgres user needs to create/socket inside it

# --- Postgres ---------------------------------------------------------------
echo "== initdb + start postgres 16"
"${PGRUN[@]}" "$PGBIN/initdb" -D "$PGDATA" -U verity --auth=trust >/dev/null
"${PGRUN[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $WORK -c listen_addresses=$PGHOST" \
  -l "$WORK/pg.log" -w start >/dev/null
"${PGRUN[@]}" "$PGBIN/createdb" -h "$PGHOST" -p "$PGPORT" -U verity verity

echo "== apply migrations 0001-0003"
for m in 0001_schema_v1 0002_compute_network 0003_platform_wiring; do
  "$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U verity -d verity -v ON_ERROR_STOP=1 \
    -q -f "infra/migrations/${m}.sql" >/dev/null
done
psql_q() { "$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U verity -d verity -tA -c "$1"; }

# --- build gateway ----------------------------------------------------------
echo "== build gateway"
(cd services/gateway && go build -o "$WORK/gateway" .)

# --- boot brain (gRPC via uvicorn lifespan) ---------------------------------
echo "== boot brain"
env -C services/brain \
  DATABASE_URL="$DBURL" ENCRYPTION_KEY="$ENC_KEY" \
  VERITY_DEV_MODE=1 VERITY_DEFAULT_MODEL="echo:echo" \
  BRAIN_GRPC_ADDR="$GRPC_ADDR" VERITY_OFFICE_STATE_PATH="$WORK/offices" \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 58091 \
  >"$WORK/brain.log" 2>&1 &
BRAIN_PID=$!

echo "== boot gateway"
env VERITY_DEV_MODE=1 VERITY_DEV_USER_ID="e2e_user_a" \
  BRAIN_GRPC_ADDR="$GRPC_ADDR" GATEWAY_ADDR="$GW_ADDR" \
  "$WORK/gateway" >"$WORK/gateway.log" 2>&1 &
GW_PID=$!

# wait for gateway healthz
for i in $(seq 1 50); do
  curl -sf "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 0.2
  [ "$i" = 50 ] && fail "gateway did not come up (see $WORK/gateway.log)"
done
# wait for brain gRPC (chat returns non-connection-refused)
for i in $(seq 1 50); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$BASE/v1/chat" \
    -H 'content-type: application/json' -d '{"message":"warmup"}')
  [ "$code" != "503" ] && break
  sleep 0.2
  [ "$i" = 50 ] && fail "brain gRPC not reachable (see $WORK/brain.log)"
done

# SSE helpers: extract the JSON data line for the first occurrence of an event.
sse_data() { awk -v ev="event: $2" '$0==ev{getline; sub(/^data: /,""); print; exit}' "$1"; }

# --- 1. chat persists + meta + auto-name ------------------------------------
echo "== chat: stream + persist + meta"
CHAT1="$WORK/chat1.sse"
curl -sN -XPOST "$BASE/v1/chat" -H 'content-type: application/json' \
  -d '{"message":"remember my favorite color is teal"}' >"$CHAT1"
META=$(sse_data "$CHAT1" meta)
[ -n "$META" ] || fail "no meta event on chat"
CONV_ID=$(echo "$META" | jq -r .conversation_id)
ASSISTANT_ID=$(echo "$META" | jq -r .message_id)
TITLE=$(echo "$META" | jq -r .title)
[ -n "$CONV_ID" ] && [ "$CONV_ID" != "null" ] || fail "meta missing conversation_id"
[ -n "$ASSISTANT_ID" ] && [ "$ASSISTANT_ID" != "null" ] || fail "meta missing message_id"
[ -n "$TITLE" ] && [ "$TITLE" != "null" ] || fail "meta missing auto-title"
grep -q '^event: delta' "$CHAT1" || fail "no delta events"
grep -q '^event: confidence' "$CHAT1" || fail "no confidence event"
grep -q '^event: done' "$CHAT1" || fail "no done event"
echo "   conv=$CONV_ID title=\"$TITLE\""

# persisted?
CNT=$(psql_q "select count(*) from messages where conversation_id='$CONV_ID'")
[ "$CNT" = "2" ] || fail "expected 2 persisted messages, got $CNT"

# --- 2. conversations list + detail (history) -------------------------------
echo "== conversations: list + detail"
curl -sf "$BASE/v1/conversations" | jq -e --arg id "$CONV_ID" \
  '.items | map(.id) | index($id) != null' >/dev/null || fail "conversation not in list"
DETAIL=$(curl -sf "$BASE/v1/conversations/$CONV_ID")
SHARE_ID=$(echo "$DETAIL" | jq -r .share_id)
[ -n "$SHARE_ID" ] && [ "$SHARE_ID" != "null" ] || fail "detail missing share_id"
echo "$DETAIL" | jq -e '.messages | length == 2' >/dev/null || fail "detail history wrong length"
USER_MSG_ID=$(echo "$DETAIL" | jq -r '.messages[] | select(.role=="user") | .id')

# --- 3. second chat turn in same conversation (windowing) -------------------
echo "== chat: follow-up turn (history carries)"
CHAT2="$WORK/chat2.sse"
curl -sN -XPOST "$BASE/v1/chat" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV_ID\",\"message\":\"and my favorite animal is the otter\"}" >"$CHAT2"
CNT=$(psql_q "select count(*) from messages where conversation_id='$CONV_ID'")
[ "$CNT" = "4" ] || fail "expected 4 messages after follow-up, got $CNT"

# --- 4. regenerate ----------------------------------------------------------
echo "== regenerate assistant message"
REGEN="$WORK/regen.sse"
curl -sN -XPOST "$BASE/v1/messages/$ASSISTANT_ID/regenerate" \
  -H 'content-type: application/json' -d '{}' >"$REGEN"
grep -q '^event: meta' "$REGEN" || fail "regenerate missing meta"
grep -q '^event: done' "$REGEN" || fail "regenerate missing done"

# --- 5. edit a user message (truncates below, restreams) --------------------
echo "== edit user message"
EDIT="$WORK/edit.sse"
curl -sN -XPATCH "$BASE/v1/messages/$USER_MSG_ID" \
  -H 'content-type: application/json' -d '{"content":"actually my favorite color is amber"}' >"$EDIT"
grep -q '^event: done' "$EDIT" || fail "edit missing done"
EDITED=$(psql_q "select content from messages where id='$USER_MSG_ID'")
[ "$EDITED" = "actually my favorite color is amber" ] || fail "edit did not persist: $EDITED"

# --- 6. provider key PUT -> vaulted -----------------------------------------
echo "== provider-key PUT -> vault"
curl -sf -XPUT "$BASE/v1/provider-keys/anthropic" \
  -H 'content-type: application/json' -d '{"key":"sk-ant-e2e-SECRET-vault-token"}' \
  | jq -e '.configured == true' >/dev/null || fail "PUT provider-key not configured"
# GET never returns key material
curl -sf "$BASE/v1/provider-keys" | jq -e \
  '.providers[] | select(.provider=="anthropic") | .configured == true' >/dev/null \
  || fail "provider-keys list missing anthropic"
curl -sf "$BASE/v1/provider-keys" | grep -qi 'SECRET' && fail "key material leaked in GET"
curl -sf "$BASE/v1/me" | jq -e \
  '.providers[] | select(.id=="anthropic") | .configured == true' >/dev/null \
  || fail "/me does not reflect vaulted anthropic key"
# ciphertext only in DB, no plaintext
psql_q "select encode(key_ciphertext,'escape') from provider_keys where provider='anthropic'" \
  | grep -qi 'SECRET' && fail "plaintext key found in DB"
CIPHER_LEN=$(psql_q "select octet_length(key_ciphertext) from provider_keys where provider='anthropic'")
[ "$CIPHER_LEN" -gt 0 ] || fail "no ciphertext stored"
echo "   ciphertext bytes=$CIPHER_LEN (no plaintext)"

# --- 7. office create + run + STATE checkpoint ------------------------------
echo "== office create + run"
OFFICE=$(curl -sf -XPOST "$BASE/v1/offices" -H 'content-type: application/json' \
  -d '{"name":"daily-digest","brief":"summarize the day and then list follow-ups"}')
OFFICE_ID=$(echo "$OFFICE" | jq -r .id)
[ -n "$OFFICE_ID" ] && [ "$OFFICE_ID" != "null" ] || fail "office not created"
RUN=$(curl -sf -XPOST "$BASE/v1/offices/$OFFICE_ID/run" -H 'content-type: application/json')
RUN_ID=$(echo "$RUN" | jq -r .run_id)
[ -n "$RUN_ID" ] && [ "$RUN_ID" != "null" ] || fail "office run not started"
STATUS=""
for i in $(seq 1 40); do
  RD=$(curl -sf "$BASE/v1/offices/$OFFICE_ID/runs/$RUN_ID")
  STATUS=$(echo "$RD" | jq -r .status)
  [ "$STATUS" = "done" ] || [ "$STATUS" = "failed" ] && break
  sleep 0.25
done
[ "$STATUS" = "done" ] || fail "office run did not finish (status=$STATUS)"
echo "$RD" | jq -r .state_md | grep -q '## Autonomy' || fail "STATE.md missing autonomy preamble"
echo "   office run $RUN_ID status=$STATUS"

# --- 8. upload -> markitdown -> referenced from chat ------------------------
echo "== upload -> markitdown"
printf '# E2E Doc\n\nThe secret project codename is Nightingale.\n' >"$WORK/doc.md"
UP=$(curl -sf -XPOST "$BASE/v1/upload" -F "file=@$WORK/doc.md;type=text/markdown")
FILE_ID=$(echo "$UP" | jq -r .file_id)
MDBYTES=$(echo "$UP" | jq -r .markdown_bytes)
[ -n "$FILE_ID" ] && [ "$FILE_ID" != "null" ] || fail "upload returned no file_id"
[ "$MDBYTES" -gt 0 ] || fail "upload markdown_bytes not positive"
echo "   file_id=$FILE_ID markdown_bytes=$MDBYTES"
# reference it from chat (echo provider won't quote it, but the path must work)
curl -sN -XPOST "$BASE/v1/chat" -H 'content-type: application/json' \
  -d "{\"message\":\"summarize the attached\",\"files\":[\"$FILE_ID\"]}" \
  | grep -q '^event: done' || fail "chat with file reference failed"

# --- 9. branch (flow) -------------------------------------------------------
echo "== branch message -> flow run"
# Re-fetch a currently-live message id (regenerate/edit above truncated the
# original turns), then branch from it.
LIVE_MSG=$(curl -sf "$BASE/v1/conversations/$CONV_ID" \
  | jq -r '[.messages[] | select(.role=="assistant")] | last | .id')
[ -n "$LIVE_MSG" ] && [ "$LIVE_MSG" != "null" ] || fail "no live assistant message to branch"
BR=$(curl -sf -XPOST "$BASE/v1/branches" -H 'content-type: application/json' \
  -d "{\"message_id\":\"$LIVE_MSG\",\"kind\":\"flow\",\"brief\":\"expand this into a plan\"}")
BR_RUN=$(echo "$BR" | jq -r .run_id)
[ -n "$BR_RUN" ] && [ "$BR_RUN" != "null" ] || fail "branch returned no run_id"
BRCNT=$(psql_q "select count(*) from branches where run_id='$BR_RUN'")
[ "$BRCNT" = "1" ] || fail "branch row not recorded"
FRCNT=$(psql_q "select count(*) from flow_runs where id='$BR_RUN'")
[ "$FRCNT" = "1" ] || fail "flow_run row not created for branch"
echo "   branch flow run=$BR_RUN"

# --- 10. public transcript (NO auth) ----------------------------------------
echo "== public transcript by share id"
# Note: no Authorization header, and gateway dev mode still injects a user, but
# the transcript route is mounted OUTSIDE /v1 auth and keyed only by share id.
TR=$(curl -sf "$BASE/v1/transcripts/$SHARE_ID")
echo "$TR" | jq -e '.messages | length >= 2' >/dev/null || fail "transcript has no messages"
echo "$TR" | jq -e '.title | length > 0' >/dev/null || fail "transcript missing title"
# unknown share id -> 404
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/v1/transcripts/deadbeefdeadbeef")
[ "$code" = "404" ] || fail "unknown transcript should 404, got $code"

echo
echo "persistence E2E: ALL CHECKS PASSED"
