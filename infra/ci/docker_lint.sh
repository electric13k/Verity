#!/usr/bin/env bash
# Verity v2 — light Dockerfile + prod-compose sanity check (M6 IaC).
#
# Standalone: run locally or wire into CI later (does NOT touch
# .github/workflows). No docker daemon required — pure static inspection, plus
# `docker compose config` when the CLI is present.
#
#   ./infra/ci/docker_lint.sh
#
# Exit non-zero if any hard check fails; warnings do not fail the run.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
fail=0
warn=0
ok()   { printf '  ok   %s\n' "$*"; }
bad()  { printf '  FAIL %s\n' "$*"; fail=$((fail+1)); }
note() { printf '  warn %s\n' "$*"; warn=$((warn+1)); }

echo "== Dockerfiles =="
for df in services/gateway/Dockerfile services/brain/Dockerfile \
          services/core/Dockerfile services/node/Dockerfile; do
  [[ -f "$df" ]] || { bad "$df missing"; continue; }
  # Non-root: must declare USER and it must not resolve to root/0.
  if grep -qE '^\s*USER\s+' "$df"; then
    if grep -qE '^\s*USER\s+(root|0)\b' "$df"; then
      bad "$df runs as root (USER root/0)"
    else
      ok "$df sets a non-root USER"
    fi
  else
    bad "$df has no USER (would run as root)"
  fi
  # Healthcheck present.
  grep -qE '^\s*HEALTHCHECK' "$df" && ok "$df has a HEALTHCHECK" \
    || bad "$df has no HEALTHCHECK"
  # Multi-stage (build stage separate from runtime).
  [[ "$(grep -cE '^\s*FROM ' "$df")" -ge 2 ]] && ok "$df is multi-stage" \
    || note "$df is single-stage (larger image?)"
  # Warn on floating base tags in FROM (reproducibility).
  if grep -E '^\s*FROM ' "$df" | grep -qE ':latest(\s|$)'; then
    note "$df pins a base image to :latest"
  fi
done

echo "== compose.prod.yaml (static) =="
cp="infra/docker/compose.prod.yaml"
if [[ -f "$cp" ]]; then
  # private network must be internal.
  grep -qE 'internal:\s*true' "$cp" && ok "private network is internal: true" \
    || bad "no 'internal: true' network in $cp"
  # Exactly one ports: block (the gateway).
  n_ports="$(grep -cE '^\s*ports:' "$cp")"
  if [[ "$n_ports" -eq 1 ]]; then
    ok "exactly one published-ports block (gateway)"
  else
    bad "$n_ports 'ports:' blocks in $cp (expected 1 — only gateway may publish)"
  fi
  # No secret-looking literals assigned inline.
  if grep -nEi '(password|secret|api_key|token|encryption_key)\s*:\s*["'\'']?[A-Za-z0-9._/+-]{12,}' "$cp" \
       | grep -viE '\$\{|:-\}|:\?|CHANGE|REPLACE|PLACEHOLDER' >/dev/null; then
    bad "possible inline secret literal in $cp"
  else
    ok "no inline secret literals in $cp"
  fi
else
  bad "$cp missing"
fi

echo "== .env.prod.example (no real secrets) =="
env="infra/docker/.env.prod.example"
if [[ -f "$env" ]]; then
  # Secret-named keys must be empty or an obvious placeholder.
  badvars=0
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    key="${line%%=*}"; val="${line#*=}"
    case "$key" in
      *KEY|*SECRET|*PASSWORD|*TOKEN|*API_KEY)
        if [[ -n "$val" ]] && ! [[ "$val" =~ (REPLACE|PLACEHOLDER|CHANGE|verity) ]]; then
          bad ".env.prod.example: $key has a non-placeholder value"
          badvars=$((badvars+1))
        fi ;;
    esac
  done < "$env"
  [[ "$badvars" -eq 0 ]] && ok "secret-named vars are empty/placeholder"
else
  bad "$env missing"
fi

echo "== docker compose config (if CLI present) =="
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  tmp_env="$(mktemp)"; echo "POSTGRES_PASSWORD=lint_only" > "$tmp_env"
  if docker compose -f "$cp" --env-file "$tmp_env" --profile data --profile compute config >/dev/null 2>/tmp/verity_compose_lint.err; then
    ok "compose config parses (all profiles)"
  else
    bad "compose config failed: $(head -1 /tmp/verity_compose_lint.err)"
  fi
  rm -f "$tmp_env"
else
  note "docker compose CLI not available — skipped config parse"
fi

echo
echo "== summary: $fail failure(s), $warn warning(s) =="
[[ "$fail" -eq 0 ]]
